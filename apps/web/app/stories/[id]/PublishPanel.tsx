'use client';

import { useState } from 'react';
import { api, type Story } from '@/lib/api';

function Switch({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors disabled:opacity-40 ${
        on ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line)]'
      }`}
    >
      <span
        className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${
          on ? 'left-[19px]' : 'left-[3px]'
        }`}
      />
    </button>
  );
}

export default function PublishPanel({
  story,
  onChange,
}: {
  story: Story;
  onChange: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only appears on the way out of private, which is the one moment the answer
  // is actually needed.
  const [asking, setAsking] = useState(false);

  const isPublic = story.visibility !== 'PRIVATE';

  async function save(patch: Parameters<typeof api.updateStory>[1]) {
    setBusy(true);
    setError(null);
    try {
      await api.updateStory(story.id, patch);
      await onChange();
      setAsking(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function togglePublic(next: boolean) {
    if (!next) return void save({ visibility: 'PRIVATE' });

    // Going public needs a fork policy. Ask only if it was never answered.
    if (story.allowForks === null) return setAsking(true);
    void save({ visibility: 'PUBLIC' });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start gap-3">
        <Switch
          on={isPublic}
          disabled={busy}
          onChange={togglePublic}
          label="Công khai"
        />
        <div className="min-w-0">
          <div className="text-[13px] font-medium">Công khai</div>
          <p className="text-[12px] text-[var(--color-muted)]">
            {isPublic
              ? 'Truyện đang hiện ở Khám phá, ai cũng đọc được.'
              : 'Chỉ mình bạn thấy. Truyện nằm yên ở đây cho tới khi bạn đăng.'}
          </p>
        </div>
      </div>

      {/* A private story has no audience, so there is nobody to allow or
          refuse. The question only means something once it is published. */}
      {isPublic && (
        <div className="flex items-start gap-3 border-t border-[var(--color-line)] pt-4">
          <Switch
            on={story.allowForks === true}
            disabled={busy}
            onChange={(next) => void save({ allowForks: next })}
            label="Cho phép rẽ nhánh"
          />
          <div className="min-w-0">
            <div className="text-[13px] font-medium">Cho phép rẽ nhánh</div>
            <p className="text-[12px] text-[var(--color-muted)]">
              {story.allowForks
                ? 'Người đọc có thể viết tiếp theo hướng của họ. Bản của bạn không đổi.'
                : 'Chỉ bạn viết tiếp. Các nhánh đã có vẫn giữ nguyên.'}
            </p>
          </div>
        </div>
      )}

      {asking && (
        <div className="flex flex-col gap-2.5 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3">
          <p className="text-[13px]">
            Cho người khác rẽ nhánh truyện này?
          </p>
          <p className="text-[12px] text-[var(--color-muted)]">
            Họ viết tiếp theo hướng riêng, bản của bạn giữ nguyên. Đổi lại lúc
            nào cũng được.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() =>
                void save({ visibility: 'PUBLIC', allowForks: true })
              }
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-mono text-[12px] text-white disabled:opacity-40"
            >
              đăng · cho phép
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void save({ visibility: 'PUBLIC', allowForks: false })
              }
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-[12px] disabled:opacity-40"
            >
              đăng · không cho phép
            </button>
            <button
              disabled={busy}
              onClick={() => setAsking(false)}
              className="px-2 py-1.5 font-mono text-[12px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              huỷ
            </button>
          </div>
        </div>
      )}

      {error && <p className="font-mono text-[11px] text-red-500">{error}</p>}
    </section>
  );
}
