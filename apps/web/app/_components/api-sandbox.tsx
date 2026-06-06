'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SketchResultViewer } from './sketch-result-viewer';

type Result = { label: string; status: number | string; body: unknown } | null;

async function callJson(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep as text */
  }
  return { status: res.status, body: parsed };
}

export function ApiSandbox() {
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [jobId, setJobId] = useState('');
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);

  async function run(
    label: string,
    fn: () => Promise<{ status: number | string; body: unknown }>,
  ) {
    setBusy(true);
    try {
      const r = await fn();
      setResult({ label, ...r });
    } catch (err) {
      setResult({ label, status: 'error', body: String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File) {
    // 1. presign
    const presign = await callJson('POST', '/api/uploads/presign', {
      filename: file.name,
      content_type: file.type,
    });
    if (presign.status !== 200) return presign;

    // 2. 직접 업로드 (Supabase signed upload URL)
    const { path, token } = presign.body as { path: string; token: string };
    const supabase = createClient();
    const { error } = await supabase.storage
      .from('uploads')
      .uploadToSignedUrl(path, token, file, { contentType: file.type });

    if (error) {
      return { status: 'upload_failed', body: { presign: presign.body, error: error.message } };
    }
    return { status: 200, body: { uploaded_path: path } };
  }

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-medium">API 검증</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <Btn
          disabled={busy}
          onClick={() =>
            run('POST /api/projects', () =>
              callJson('POST', '/api/projects', { title: '테스트 프로젝트' }),
            )
          }
        >
          POST /api/projects (생성)
        </Btn>

        <Btn
          disabled={busy}
          onClick={() => run('GET /api/projects', () => callJson('GET', '/api/projects'))}
        >
          GET /api/projects (목록)
        </Btn>
      </div>

      <Row label="project_id" value={projectId} onChange={setProjectId}>
        <Btn
          disabled={busy || !projectId}
          onClick={() =>
            run(`GET /api/projects/${projectId}`, () =>
              callJson('GET', `/api/projects/${projectId}`),
            )
          }
        >
          GET 단일
        </Btn>
        <Btn
          disabled={busy || !projectId}
          onClick={() =>
            run(`PATCH /api/projects/${projectId}`, () =>
              callJson('PATCH', `/api/projects/${projectId}`, {
                title: '수정된 제목 ' + new Date().toLocaleTimeString('ko-KR'),
              }),
            )
          }
        >
          PATCH 제목
        </Btn>
      </Row>

      <div className="space-y-2 rounded-md border border-input p-3">
        <p className="text-sm font-medium">파일 업로드 (presign + uploadToSignedUrl)</p>
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) run('upload', () => uploadFile(file));
          }}
          className="block text-sm"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Btn
          disabled={busy}
          onClick={() =>
            run('POST /api/generate', () =>
              callJson('POST', '/api/generate', {
                kind: 'image_to_sketch',
                project_id: projectId || undefined,
                input: { source_path: 'placeholder' },
              }),
            )
          }
        >
          POST /api/generate (job 생성)
        </Btn>

        <Row label="job_id" value={jobId} onChange={setJobId}>
          <Btn
            disabled={busy || !jobId}
            onClick={() =>
              run(`GET /api/jobs/${jobId}`, () => callJson('GET', `/api/jobs/${jobId}`))
            }
          >
            GET job
          </Btn>
        </Row>

        <Btn
          disabled={busy}
          onClick={() => run('GET /api/jobs', () => callJson('GET', '/api/jobs'))}
        >
          GET /api/jobs (목록)
        </Btn>
      </div>

      {jobId ? (
        <SketchResultViewer jobId={jobId} onPartSelect={setSelectedPartId} />
      ) : null}

      {jobId ? (
        <div className="rounded-md border border-input p-3 text-sm">
          <span className="font-medium">선택된 part: </span>
          <span className="font-mono text-muted-foreground">
            {selectedPartId ?? '없음'}
          </span>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-2 rounded-md border border-input p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{result.label}</span>
            <span className="text-muted-foreground">status: {String(result.status)}</span>
          </div>
          <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

function Btn({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Row({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="uuid"
        className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      {children}
    </div>
  );
}
