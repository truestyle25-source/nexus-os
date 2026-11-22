// Tipagem mínima do nodemailer 10 (o pacote não publica .d.ts e @types/nodemailer cobre só até a 9).
// Só o que a integração de e-mail usa: createTransport, verify, sendMail e close.
declare module 'nodemailer' {
  export interface Anexo { filename: string; content: Buffer; contentType?: string }
  export interface Mensagem { from: string; to: string | string[]; cc?: string | string[]; replyTo?: string; subject: string; html?: string; text?: string; attachments?: Anexo[] }
  export interface Transportador {
    verify(): Promise<true>;
    sendMail(m: Mensagem): Promise<{ messageId: string; accepted: unknown[]; rejected: unknown[] }>;
    close(): void;
  }
  export function createTransport(opcoes: Record<string, unknown>): Transportador;
  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
