import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

function body(code: string, message: string, details?: unknown): ErrorBody {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

export function unauthorized(message = '인증이 필요합니다.') {
  return NextResponse.json(body('unauthorized', message), { status: 401 });
}

export function notFound(message = '리소스를 찾을 수 없습니다.') {
  return NextResponse.json(body('not_found', message), { status: 404 });
}

export function forbidden(message = '권한이 없습니다.') {
  return NextResponse.json(body('forbidden', message), { status: 403 });
}

export function conflict(message = '이미 존재합니다.') {
  return NextResponse.json(body('conflict', message), { status: 409 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json(body('bad_request', message, details), { status: 400 });
}

export function zodErrorResponse(err: ZodError) {
  return NextResponse.json(
    body('validation_error', '요청 본문 검증 실패', err.flatten()),
    { status: 400 },
  );
}

export function serverError(message = '서버 오류') {
  return NextResponse.json(body('server_error', message), { status: 500 });
}
