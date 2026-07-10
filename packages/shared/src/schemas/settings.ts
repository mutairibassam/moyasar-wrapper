import { z } from "zod";
import { MODES } from "../enums";

export const setKeySchema = z.object({
  mode: z.enum(MODES),
  key: z.string().min(1).max(500),
});
export type SetKeyInput = z.infer<typeof setKeySchema>;

export const setModeSchema = z.object({ mode: z.enum(MODES) });
export type SetModeInput = z.infer<typeof setModeSchema>;
