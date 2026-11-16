"""Write and length-check the original Vietnamese collection in resumable batches."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DESTINATION = ROOT / "apps/api/prisma/dark-stories"
WORK = Path(tempfile.gettempdir()) / "audio-writer-dark-stories"
SYSTEM = """Bạn là tiểu thuyết gia và biên tập viên văn xuôi Việt Nam. Viết tác phẩm gốc cho độc giả trưởng thành thích truyện đen tối, huyền bí, kinh dị và phản bội. Ngôn ngữ tự nhiên, cụ thể, có lời thoại mang cá tính, nhân vật có đời sống và động cơ mâu thuẫn. Dựng từng cảnh bằng hành động và chi tiết, để người đọc tự hiểu. Nhịp căng tăng dần, có khoảng thở nhưng mọi cảnh đều đổi tình thế hoặc quan hệ. Tuân thủ quy tắc huyền bí nhất quán, điều tra có nguyên nhân và bằng chứng. Đặt ít nhất ba manh mối sớm và cho chúng đổi ý nghĩa khi sự thật lộ ra. Người bị nghi oan cũng có bí mật thật. Cú ngoặt chính ở khoảng chương 7 hoặc 8 và chương cuối giải quyết hậu quả cụ thể cùng cung nhân vật. Đừng biến tất cả thành giấc mơ, hồi tưởng giả, bệnh tâm thần, hoặc thêm thủ phạm không được gài. Không giảng đạo, không kết bằng khẩu hiệu, không viết văn tóm tắt cốt truyện. Không sao chép tác phẩm có sẵn hoặc mô phỏng tác giả cụ thể. Quan hệ ngoại tình thể hiện qua tâm lý, hậu quả và chi tiết đời thường. Tránh cảnh tình dục mô tả trực diện. Bạo lực phục vụ truyện, không sa đà vào giải phẫu. Giữ văn xuôi sạch, không dùng dấu chấm phẩy, không dùng dấu hai chấm để dẫn giải, tránh câu văn công thức 'không phải X mà là Y'."""


def words(text):
    return len(text.split())


def complete_chapter(text):
    return bool(re.search(r"[.!?…][\"'”’»)*_\s]*$", text.strip()))


def clean_prose(text):
    text = text.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n")
    paragraphs = []
    for paragraph in re.split(r"\n\s*\n", text.strip()):
        if words(paragraph) <= 220:
            paragraphs.append(paragraph.strip())
            continue
        sentences = re.split(r"(?<=[.!?…])\s+(?=[A-ZÀ-ỴĐ\"“])", paragraph)
        current = []
        for sentence in sentences:
            current.append(sentence)
            if words(" ".join(current)) >= 110:
                paragraphs.append(" ".join(current))
                current = []
        if current:
            paragraphs.append(" ".join(current))
    return "\n\n".join(paragraphs)


def read_config():
    config = dict(os.environ)
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            config.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return config


CONFIG = read_config()
MODEL = CONFIG.get("CONTENT_MODEL", CONFIG.get("GEMINI_MODEL", "gemini-2.5-flash"))
KEY = CONFIG.get("GEMINI_API_KEY", "")
MODELS = [model.strip() for model in CONFIG.get("CONTENT_MODELS", MODEL).split(",") if model.strip()]
EXHAUSTED = set()
MODEL_LOCK = threading.Lock()


def generate(prompt, schema):
    for model in MODELS:
        with MODEL_LOCK:
            if model in EXHAUSTED:
                continue
        payload = {
            "systemInstruction": {"parts": [{"text": SYSTEM}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.95,
                "topP": 0.95,
                "maxOutputTokens": 65536,
                "thinkingConfig": {"thinkingLevel": "high"} if model.startswith("gemini-3") else {"thinkingBudget": 8192},
                "responseMimeType": "application/json",
                "responseSchema": schema,
            },
        }
        request = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": KEY},
            method="POST",
        )
        body = None
        for attempt in range(5):
            try:
                with urllib.request.urlopen(request, timeout=1200) as response:
                    body = json.load(response)
                break
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")
                if error.code == 429 and re.search(r"per.?day|PerDay|daily", detail, re.I):
                    with MODEL_LOCK:
                        EXHAUSTED.add(model)
                    print(f"DAILY QUOTA {model}; checking configured fallback", flush=True)
                    break
                if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                    raise RuntimeError(f"Gemini HTTP {error.code}. {detail[:600]}") from None
                delay = re.search(r'"retryDelay"\s*:\s*"([\d.]+)s"', detail)
                wait = min(60, max(15, int(float(delay.group(1))) + 1 if delay else 20 * (attempt + 1)))
                print(f"Provider retry in {wait}s (HTTP {error.code})", flush=True)
                time.sleep(wait)
        if body is None:
            continue
        candidate = body.get("candidates", [{}])[0]
        if candidate.get("finishReason") != "STOP":
            raise RuntimeError(f"Incomplete generation ({candidate.get('finishReason', 'no candidate')}).")
        text = "".join(part.get("text", "") for part in candidate.get("content", {}).get("parts", []) if not part.get("thought"))
        value = json.loads(text)
        value["modelName"] = model
        if "text" in value:
            value["text"] = clean_prose(value["text"])
        for chapter in value.get("chapters", []):
            chapter["modelName"] = model
            chapter["text"] = clean_prose(chapter["text"])
        for replacement in value.get("replacements", []):
            replacement["after"] = clean_prose(replacement["after"])
        return value
    raise RuntimeError("Daily quota exhausted for all configured writing models. Manuscripts remain saved.")


CHAPTER_SCHEMA = {
    "type": "OBJECT",
    "properties": {"title": {"type": "STRING"}, "text": {"type": "STRING"}},
    "required": ["title", "text"],
}
STORY_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "synopsis": {"type": "STRING"},
        "chapters": {"type": "ARRAY", "minItems": 10, "maxItems": 10, "items": CHAPTER_SCHEMA},
    },
    "required": ["synopsis", "chapters"],
}
def part_schema(count):
    return {
        **STORY_SCHEMA,
        "properties": {
            **STORY_SCHEMA["properties"],
            "chapters": {"type": "ARRAY", "minItems": count, "maxItems": count, "items": CHAPTER_SCHEMA},
        },
    }


def save(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def validate(story):
    chapters = story.get("chapters", [])
    counts = [words(chapter.get("text", "")) for chapter in chapters]
    if len(chapters) != 10 or not 10000 <= sum(counts) <= 15000:
        return False
    if any(not chapter.get("title", "").strip() for chapter in chapters):
        return False
    if any(not complete_chapter(chapter["text"]) for chapter in chapters):
        return False
    if any("\ufffd" in chapter["text"] or re.search(r"\w\?+\w", chapter["title"] + " " + chapter["text"]) for chapter in chapters):
        return False
    return bool(story.get("synopsis", "").strip())


def write_story(brief, rewrite=False):
    path = DESTINATION / f"{brief['slug']}.json"
    draft_path = WORK / path.name
    if path.exists() and not rewrite and (not draft_path.exists() or path.stat().st_mtime >= draft_path.stat().st_mtime):
        story = json.loads(path.read_text(encoding="utf-8"))
        if validate(story):
            print(f"EXISTS {brief['title']} | {sum(words(c['text']) for c in story['chapters'])} words", flush=True)
            return
    if draft_path.exists() and not rewrite:
        draft = json.loads(draft_path.read_text(encoding="utf-8"))
    else:
        prompt = f"""Viết TRỌN VẸN truyện '{brief['title']}' theo hồ sơ bên dưới. ĐẦU RA PHẢI LÀ VĂN BẢN HOÀN CHỈNH, không viết dàn ý. Viết 10 chương, MỖI CHƯƠNG 1.150–1.350 chữ tách bằng khoảng trắng, tổng 11.500–13.500 chữ. Độ dài là yêu cầu bắt buộc. Có đủ ngân sách đầu ra 65.536 token nên hãy viết đầy đủ, không rút gọn chương cuối. Mỗi chương phải có nhiều cảnh sống động, đối thoại và nội tâm. Mười chương nối tiếp thành một câu chuyện có kết thúc. Hãy dành khoảng hai chương cuối cho cao trào và hậu quả, hoàn tất các tuyến. Phần synopsis chỉ 70–110 chữ, tạo tò mò và giữ kín sự thật cuối. Giữ nguyên nhan đề và bối cảnh. Hồ sơ chứa bí mật tác giả, đừng kể ngay từ đầu.

Trước khi viết, hãy suy nghĩ kỹ về logic diễn biến, dòng thời gian, động cơ và cách trả từng manh mối. Giữ NGUYÊN sự thật, cơ chế siêu nhiên và kết cục trong hồ sơ. Chỉ bổ sung nhân vật để tạo đời sống hoặc sức ép, tuyệt đối đừng thêm một thủ phạm nhận mọi lỗi thay nhân vật chính. Sự thú nhận phải gây hậu quả thật diễn ra trên trang, không chỉ hứa sẽ thú nhận. Cao trào cần hành động lựa chọn có rủi ro và cái giá, tránh cuộc đối thoại giải thích xong rồi gọi công an là hết. Không dùng hàng loạt câu 'cô cảm thấy', 'ánh mắt đầy vẻ', 'mọi thứ đã thay đổi', 'cô biết mình phải đối mặt', 'và cô sẽ'. Đừng kết chương bằng các đoạn lặp quyết tâm mơ hồ. Kết bằng một việc cụ thể đã đổi nghĩa hoặc buộc hành động tiếp. Tăng độ dài bằng cảnh và đối thoại có xung đột thật, không bằng diễn giải lại manh mối. Trong title chỉ ghi tên chương, bỏ số thứ tự và tiền tố Chương. Trong văn xuôi không có dấu chấm phẩy, tránh cấu trúc so sánh phủ định công thức và các lời tổng kết đạo lý.

{json.dumps(brief, ensure_ascii=False)}

Hãy viết từng chương dài 1.150–1.350 chữ ngay trong trường text. Độc giả đọc văn xuôi thực thụ, cần cảm thấy thời gian trôi trong cảnh, không đọc bản tóm tắt. Kết chương có thay đổi cụ thể. Chương 10 kết thúc hoàn chỉnh, không hẹn phần sau."""
        print(f"WRITING {brief['title']}", flush=True)
        if MODEL.startswith("gemini-2.5"):
            draft = generate(prompt, STORY_SCHEMA)
        else:
            draft = generate(prompt + "\n\nLƯỢT VIẾT THỨ NHẤT chỉ trả lại chương 1–3, mỗi chương 1.400–1.550 chữ. Hãy phát triển đủ cảnh để phần này dài ít nhất 4.000 chữ. Giữ các bước ngoặt cuối cho lượt sau. Phần tiếp theo sẽ được viết riêng nên đừng rút gọn để cố kết thúc truyện trong lượt này.", part_schema(3))
        save(draft_path, draft)
    while len(draft["chapters"]) < 10:
        first = len(draft["chapters"]) + 1
        count = min(3, 11 - first)
        last = first + count - 1
        prompt = f"""Viết tiếp TRỌN VẸN chương {first}–{last} của tiểu thuyết '{brief['title']}'. Mỗi chương 1.400–1.550 chữ, lượt này cần khoảng {count * 1400}–{count * 1550} chữ. Giữ đúng toàn bộ dữ kiện, tên người, giọng kể, mốc thời gian, vật chứng của những chương đã viết. Đưa cú ngoặt đúng hồ sơ ra ở chương 7–8 qua cảnh hành động, hoàn tất cao trào và kể hậu quả thật trong chương 9–10. Chỉ kết thúc truyện ở chương 10. Kết thúc theo hồ sơ, giữ chất đen tối và những mất mát cụ thể. Không thêm kẻ ác mới để gánh lỗi thay nhân vật chính, không tóm tắt hậu quả bằng vài câu. Không dùng lời đạo lý, khẩu hiệu hoặc câu 'cuộc đời đã thay đổi', 'sự thật giải thoát', 'bình yên của tâm hồn'. Tên chương chỉ có tên, không ghi số. Mỗi chương gồm nhiều đoạn văn cách nhau bằng dòng trống. Trả synopsis như cũ và đúng {count} chương tiếp theo, không lặp phần đã viết.

HỒ SƠ
{json.dumps(brief, ensure_ascii=False)}

NHỮNG CHƯƠNG ĐÃ VIẾT
{json.dumps(draft, ensure_ascii=False)}"""
        print(f"WRITING {brief['title']} | chapters {first}–{last}", flush=True)
        continuation = generate(prompt, part_schema(count))
        draft["chapters"].extend(continuation["chapters"])
        save(draft_path, draft)
    for pass_index in range(3):
        counts = [words(chapter["text"]) for chapter in draft["chapters"]]
        print(f"LENGTH {brief['title']} | {sum(counts)} | {counts}", flush=True)
        if validate(draft):
            story = {
                "slug": brief["slug"],
                "title": brief["title"],
                "genres": brief["genres"],
                "synopsis": draft["synopsis"],
                "modelProvider": "gemini",
                "modelName": ", ".join(sorted({chapter.get("modelName", MODEL) for chapter in draft["chapters"]})),
                "chapters": draft["chapters"],
            }
            if draft.get("editorialReview"):
                story["editorialReview"] = draft["editorialReview"]
            save(path, story)
            print(f"COMPLETE {brief['title']} | {sum(counts)} words", flush=True)
            return
        order = sorted(range(len(draft["chapters"])), key=lambda index: words(draft["chapters"][index]["text"]), reverse=sum(counts) > 15000)
        for index in order:
            chapter = draft["chapters"][index]
            total = sum(words(c["text"]) for c in draft["chapters"])
            count = words(chapter["text"])
            if 10000 <= total <= 15000 and complete_chapter(chapter["text"]):
                continue
            if total < 10000 and count >= 1150 and complete_chapter(chapter["text"]):
                continue
            if total > 15000 and count <= 1350 and complete_chapter(chapter["text"]):
                continue
            previous = " ".join(draft["chapters"][index - 1]["text"].split()[-350:]) if index else "Đây là chương mở đầu."
            following = " ".join(draft["chapters"][index + 1]["text"].split()[:350]) if index < 9 else "Đây là chương kết thúc hoàn chỉnh."
            timeline = [{"chapter": position + 1, "title": item["title"], "ending": " ".join(item["text"].split()[-100:])} for position, item in enumerate(draft["chapters"])]
            prompt = f"""Biên tập lại CHƯƠNG {index + 1} của truyện sau thành chương hoàn chỉnh 1.150–1.350 chữ tiếng Việt (đếm bằng khoảng trắng). Hiện chương có {count} chữ. Viết lại bằng nhiều cảnh cụ thể, đối thoại và nội tâm, giữ mọi sự kiện đã gài và tính liên tục với chương khác. Đừng kể thay những phần dành cho chương sau. Trả title và text của riêng chương này, tối thiểu 1.150 chữ. Toàn truyện phải đạt ít nhất 10.000 chữ nên không thể viết ngắn. Giữ giọng kể và thời kể nhất quán. Hồ sơ tác giả và bản thảo đầy đủ để đối chiếu bên dưới.

Giữ chính xác trạng thái điều tra và quan hệ ở đầu, cuối chương này. Chỉ phát triển những cảnh ở giữa. Đừng giải quyết sớm một việc dành cho chương sau hoặc kể lại cao trào đã diễn ra. Các đoạn kết cả truyện được cung cấp để kiểm tra diễn tiến, không mang sự kiện từ những chương ấy vào chương đang sửa. Chỉ chương 10 được kết thúc toàn bộ câu chuyện.

HỒ SƠ
{json.dumps(brief, ensure_ascii=False)}

ĐIỂM ĐẾN CỦA TỪNG CHƯƠNG
{json.dumps(timeline, ensure_ascii=False)}

CUỐI CHƯƠNG TRƯỚC
{previous}

CHƯƠNG CẦN BIÊN TẬP
{json.dumps(chapter, ensure_ascii=False)}

ĐẦU CHƯƠNG SAU
{following}

Chỉ viết lại chương {index + 1}, dài 1.150–1.350 chữ. Đầu ra title và text, không bình luận."""
            print(f"REVISING {brief['title']} | chapter {index + 1} | {count} words", flush=True)
            replacement = generate(prompt, CHAPTER_SCHEMA)
            if not complete_chapter(replacement["text"]):
                print(f"INCOMPLETE CHAPTER {brief['title']} | chapter {index + 1}; retaining previous draft", flush=True)
                continue
            if total < 10000 and words(replacement["text"]) < count + 100:
                print(f"INSUFFICIENT EXPANSION {brief['title']} | chapter {index + 1}; retaining previous draft", flush=True)
                continue
            draft["chapters"][index] = replacement
            save(draft_path, draft)
    raise RuntimeError(f"Manuscript did not satisfy length and structure requirements: {brief['title']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--workers", type=int, default=3, choices=(1, 2, 3, 4, 5, 6))
    parser.add_argument("--rewrite", action="store_true")
    args = parser.parse_args()
    briefs = json.loads((DESTINATION / "briefs.json").read_text(encoding="utf-8"))
    if len(briefs) != 50 or len({b["slug"] for b in briefs}) != 50:
        raise RuntimeError("The collection must have 50 distinct story briefs.")
    WORK.mkdir(parents=True, exist_ok=True)
    selected = briefs[args.start - 1:]
    if args.limit:
        selected = selected[:args.limit]
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        for offset in range(0, len(selected), args.workers):
            tasks = [executor.submit(write_story, brief, args.rewrite) for brief in selected[offset:offset + args.workers]]
            for task in tasks:
                task.result()
    print(f"BATCH COMPLETE | {len(selected)} stories", flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except Exception as error:
        print(f"STOPPED | {error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
