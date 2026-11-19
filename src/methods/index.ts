/**
 * src/methods/index.ts — the method registry.
 *
 * A video names exactly one method (settings.method, default "factory").
 * This module is the only place that knows all three, and the only place that
 * imports each method's code. The method directories themselves never import
 * each other — src/methods/isolation.test.ts enforces that.
 *
 * Adding a fourth method means: a directory, an entry here, a value in METHODS
 * (src/methods/types.ts), and a SettingsSchema enum member. Nothing else.
 */
import type { ShotSpec } from "../generator/spec.schema";
import { animationMethod } from "./animation";
import { factoryMethod } from "./factory";
import { lemoMethod } from "./lemo";
import { METHODS, type MethodId, type MethodImpl } from "./types";

const REGISTRY: Record<MethodId, MethodImpl> = {
  factory: factoryMethod,
  animation: animationMethod,
  lemo: lemoMethod,
};

export function listMethods(): MethodImpl[] {
  return METHODS.map((id) => REGISTRY[id]);
}

/** The method id a spec asks for. Absent settings/field means "factory". */
export function methodIdOf(spec: Pick<ShotSpec, "settings">): MethodId {
  return spec.settings?.method ?? "factory";
}

/**
 * The implementation for a spec's method. Throws with the valid list rather
 * than returning undefined, so a bad value never reaches a renderer.
 */
export function resolveMethod(spec: Pick<ShotSpec, "settings">): MethodImpl {
  const id = methodIdOf(spec);
  const impl = REGISTRY[id];
  if (!impl) {
    throw new Error(
      `unknown video method "${String(id)}" — valid methods: ${METHODS.join(", ")}`,
    );
  }
  return impl;
}

export { METHODS, type MethodId, type MethodImpl } from "./types";
export { METHOD_INFO, type MethodInfo } from "./types";
export type { LemoStyleMode, MethodContext, MethodResult } from "./types";
