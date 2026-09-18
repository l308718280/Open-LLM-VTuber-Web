export const ERROR_MESSAGES = {
  invalid_request: '请求内容无效，请检查输入与图片。',
  invalid_endpoint: '服务地址无效；远端服务必须使用 HTTPS。',
  protocol: '服务返回了不符合约定的数据。',
  limit: '请求或响应超过大小限制。',
  http: '服务暂时无法处理请求。',
  busy: '服务正在处理上一轮请求，请稍后手动重试。',
  unauthorized: '身份验证失败，请检查服务授权。',
  rate_limited: '请求过于频繁，请稍后手动重试。',
  server: '服务处理失败。',
  network: '连接中断，请检查网络后手动重试。',
  timeout: '等待服务响应超时。',
  cancelled: '已停止本地等待；已执行的工具操作不会因此回滚。',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class HarnessError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'HarnessError';
  }
}

export function safeError(error: unknown): HarnessError {
  return error instanceof HarnessError ? error : new HarnessError('network');
}