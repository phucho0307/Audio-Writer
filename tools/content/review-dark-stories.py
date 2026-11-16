"""Review complete manuscripts and apply exact, length-checked editorial edits."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import re
import sys
from pathlib import Path


sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("writer", Path(__file__).with_name("generate-dark-stories.py"))
writer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(writer)

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "plotSummary": {"type": "STRING"},
        "unresolvedIssues": {"type": "ARRAY", "items": {"type": "STRING"}},
        "replacements": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "chapter": {"type": "INTEGER"},
                    "before": {"type": "STRING"},
                    "after": {"type": "STRING"},
                    "reason": {"type": "STRING"},
                },
                "required": ["chapter", "before", "after", "reason"],
            },
        },
    },
    "required": ["plotSummary", "unresolvedIssues", "replacements"],
}
REPAIR_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "chapters": {
            "type": "ARRAY",
            "minItems": 1,
            "maxItems": 3,
            "items": {
                "type": "OBJECT",
                "properties": {
                    "chapter": {"type": "INTEGER"},
                    "title": {"type": "STRING"},
                    "text": {"type": "STRING"},
                },
                "required": ["chapter", "title", "text"],
            },
        },
        "remainingIssues": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["chapters", "remainingIssues"],
}


def repair(brief):
    path = writer.DESTINATION / f"{brief['slug']}.json"
    if not path.exists():
        return
    source = path.read_text(encoding="utf-8")
    story = json.loads(source)
    editorial = story.get("editorialReview", {})
    notes = editorial.get("unresolvedIssues", [])
    unmatched = editorial.get("unmatchedEdits", [])
    if not notes and not unmatched:
        return
    prompt = f"""Biên tập bản thảo theo những ghi chú sau. Chỉ viết lại các chương THẬT SỰ CẦN SỬA, trả nội dung HOÀN CHỈNH của từng chương trong chapters, chapter là số từ 1–10. Tối đa sửa 5 chương mỗi lượt. Giữ mọi sự kiện đã đúng, tên người, mốc thời gian, vật chứng, cơ chế huyền bí và giọng kể. Giữ số chữ từng chương gần bản cũ, chênh lệch tối đa 100 chữ, để toàn truyện vẫn trong 10.000–15.000 chữ. Hiện truyện có {sum(writer.words(c['text']) for c in story['chapters'])} chữ. Cấm cắt cảnh thành tóm tắt. Thay lời giải thích bằng cảnh có hành động hoặc đối thoại, biến lựa chọn nhân vật thành một việc có cái giá cụ thể. Nếu các chương cuối lặp việc đã giải quyết trước, hãy viết hậu quả, cuộc đối chất mới hoặc mất mát theo hồ sơ để phát triển tiếp, tránh mở một vụ án mới không có gài từ đầu. Lời kể tránh công thức phủ định so sánh, dấu chấm phẩy, dấu hai chấm và tổng kết đạo lý. Mỗi chương kết bằng chi tiết cụ thể, câu văn hoàn chỉnh. remainingIssues chỉ để các lỗi nghiêm trọng thực sự còn chưa sửa, để rỗng khi hoàn tất. Giữ tính chủ quan của người kể và các giả thuyết điều tra, không biến chúng thành lỗi. Hồ sơ là ý định tác giả. Các góp ý muốn biến hiện tượng huyền bí thật thành ảo giác hoặc áp đặt sở thích thể loại trái hồ sơ cần được bác bỏ, giữ điều tác giả đã chọn. Nhận xét chung về nhịp kể chỉ áp dụng khi chỉ ra được cảnh thực sự thừa.

GHI CHÚ CẦN SỬA
{json.dumps(notes, ensure_ascii=False)}

CÁC ĐOẠN BIÊN TẬP TRƯỚC CHƯA TÌM ĐƯỢC VỊ TRÍ CHÍNH XÁC
{json.dumps(unmatched, ensure_ascii=False)}

HỒ SƠ
{json.dumps(brief, ensure_ascii=False)}

BẢN THẢO
{json.dumps(story, ensure_ascii=False)}"""
    print(f"POLISHING {brief['title']}", flush=True)
    result = writer.generate(prompt, REPAIR_SCHEMA)
    for replacement in result["chapters"]:
        index = replacement["chapter"] - 1
        if index not in range(10) or not writer.complete_chapter(replacement["text"]):
            raise RuntimeError(f"Incomplete editorial rewrite: {brief['title']}")
        story["chapters"][index] = {"title": replacement["title"], "text": replacement["text"], "modelName": result["modelName"]}
    editorial["resolvedNotes"] = notes
    editorial["unresolvedIssues"] = result["remainingIssues"]
    editorial["unmatchedEdits"] = []
    editorial["repairModel"] = result["modelName"]
    if path.read_text(encoding="utf-8") != source:
        print(f"MANUSCRIPT CHANGED DURING POLISH {brief['title']}; polish again", flush=True)
        return
    if writer.validate(story):
        writer.save(path, story)
    else:
        print(f"RESTORING LENGTH AFTER POLISH {brief['title']}", flush=True)
        writer.save(writer.WORK / path.name, story)
        writer.write_story(brief)
    print(f"POLISHED {brief['title']} | {len(result['chapters'])} chapters | {len(result['remainingIssues'])} remaining notes", flush=True)


def review(brief):
    path = writer.DESTINATION / f"{brief['slug']}.json"
    if not path.exists():
        return
    source = path.read_text(encoding="utf-8")
    story = json.loads(source)
    if story.get("editorialReview"):
        print(f"REVIEWED {brief['title']}", flush=True)
        return
    if not writer.validate(story):
        print(f"WAITING FOR COMPLETE MANUSCRIPT {brief['title']}", flush=True)
        return
    prompt = f"""Bạn là biên tập viên tiểu thuyết. Đọc TOÀN BỘ bản thảo và hồ sơ tác giả bên dưới. Kiểm tra tên nhân vật, thời gian, vật chứng, cơ chế huyền bí, gieo và trả manh mối, cú ngoặt, cao trào và hậu quả. Suy nghĩ của nhân vật có thể sai ở đầu truyện, đừng coi giả thuyết điều tra là lỗi tác giả. Những chi tiết mới hợp lý được phép bổ sung nhưng không được thay sự thật lõi hoặc cho kẻ mới gánh mọi lỗi. Kiểm tra đặc biệt việc dấu vết đã được giải thích có khớp không và kết cục đen tối của hồ sơ có được giữ.

Hãy sửa những lỗi cụ thể bằng các đoạn thay thế NGẮN VÀ CHÍNH XÁC. Mỗi replacement có chapter là số chương từ 1 đến 10, before là trích nguyên văn một đoạn xuất hiện đúng một lần trong chương, after là đoạn thay thế hoàn chỉnh, reason giải thích lỗi. Có thể sửa nhiều đoạn, giữ toàn bộ cảnh và nhân vật. Mỗi before phải sao y kể cả xuống dòng, dấu ngoặc và dấu câu, tránh các replacement chồng lên nhau. Chỉ sửa chỗ có vấn đề rõ ràng, bảo toàn phần còn lại.

Loại những lời tổng kết đạo lý, lời hứa mơ hồ và khẩu hiệu ở cuối chương bằng một hành động, cuộc đối thoại ngắn hoặc chi tiết vật chất phù hợp tình huống. Đặc biệt bỏ 'bản giao hưởng của sự hồi sinh', 'cuộc đời đã thay đổi', 'giá trị của sự thật', 'bình yên tâm hồn', 'sẵn sàng cho cuộc đời mới' nếu có. Giữ nỗi đau và hậu quả cụ thể. Viết lại cấu trúc phủ định so sánh công thức thành câu chủ động gọn khi nó chỉ làm màu. Không thêm cảnh tình dục trực diện. Truyện phải giữ 10.000–15.000 chữ, hiện có {sum(writer.words(c['text']) for c in story['chapters'])} chữ, hãy thay bằng đoạn có độ dài gần tương đương. Đừng viết văn tóm tắt để thay cảnh. Tên chương chỉ có tên, không cần số.

plotSummary tóm tắt trung thực bản thảo 150–220 chữ, có cú ngoặt và kết cục để người biên tập kiểm tra. unresolvedIssues chỉ liệt kê lỗi nghiêm trọng còn chưa sửa được bằng replacements, nếu mọi lỗi nghiêm trọng đã sửa hoặc không có thì để mảng rỗng. Đừng bịa lỗi hoặc thay nội dung theo sở thích.

HỒ SƠ TÁC GIẢ
{json.dumps(brief, ensure_ascii=False)}

BẢN THẢO
{json.dumps(story, ensure_ascii=False)}"""
    print(f"REVIEWING {brief['title']}", flush=True)
    result = writer.generate(prompt, SCHEMA)
    unmatched = []
    for replacement in result["replacements"]:
        index = replacement["chapter"] - 1
        if index not in range(10):
            raise RuntimeError(f"Invalid edit location: {brief['title']}")
        text = story["chapters"][index]["text"]
        before = replacement["before"]
        if before and text.count(before) == 1:
            story["chapters"][index]["text"] = text.replace(before, replacement["after"], 1)
            continue
        matches = []
        if before:
            pattern = r"\s+".join(re.escape(part) for part in before.split())
            for location, candidate in enumerate(story["chapters"]):
                matches.extend((location, match) for match in re.finditer(pattern, candidate["text"]))
        if len(matches) == 1:
            location, match = matches[0]
            original = story["chapters"][location]["text"]
            story["chapters"][location]["text"] = original[:match.start()] + replacement["after"] + original[match.end():]
        else:
            unmatched.append(replacement)
    story["editorialReview"] = {
        "modelName": result["modelName"],
        "plotSummary": result["plotSummary"],
        "unresolvedIssues": result["unresolvedIssues"],
        "edits": len(result["replacements"]),
        "unmatchedEdits": unmatched,
    }
    if path.read_text(encoding="utf-8") != source:
        print(f"MANUSCRIPT CHANGED DURING REVIEW {brief['title']}; review again", flush=True)
        return
    if writer.validate(story):
        writer.save(path, story)
    else:
        print(f"RESTORING LENGTH AFTER REVIEW {brief['title']}", flush=True)
        writer.save(writer.WORK / path.name, story)
        writer.write_story(brief)
    if result["unresolvedIssues"]:
        print(f"NEEDS EDITING {brief['title']} | {json.dumps(result['unresolvedIssues'], ensure_ascii=False)}", flush=True)
    else:
        print(f"REVIEW COMPLETE {brief['title']} | {len(result['replacements'])} edits", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--repair", action="store_true")
    args = parser.parse_args()
    briefs = json.loads((writer.DESTINATION / "briefs.json").read_text(encoding="utf-8"))[args.start - 1:]
    if args.limit:
        briefs = briefs[:args.limit]
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        for offset in range(0, len(briefs), args.workers):
            action = repair if args.repair else review
            tasks = [executor.submit(action, brief) for brief in briefs[offset:offset + args.workers]]
            for task in tasks:
                task.result()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except Exception as error:
        print(f"STOPPED | {error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
