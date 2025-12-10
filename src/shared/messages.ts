// content と popup 間で使うランタイムメッセージ型（将来 background 追加時も流用想定）
export type RuntimeMessage =
  | { type: "PING" }
  | { type: "SET_ENABLED"; enabled: boolean }
  | { type: "REQUEST_LOGS" }
  | { type: "LOG_PUSHED" };

export type RuntimeResponse =
  | { type: "PONG" }
  | { type: "SET_ENABLED_OK" }
  | { type: "LOGS"; logs: unknown[] };
