import type { TenantId } from "./ids.ts";

export type FrameSse = {
  streamId: string;
  seq: number;
  tenantId: TenantId;
  tipo: string;
  corpo: unknown;
};

export function envelopeFrame(f: FrameSse): string {
  return `${f.streamId}:${f.seq}`;
}
