import { DEMO_PERSONAS, type DemoPersona } from '@devcollab/shared';

export type Persona = DemoPersona;
export type PersonaId = (typeof DEMO_PERSONAS)[number]['id'];

export type PersonaIdSchema = `${PersonaId}`;

/** Resolve a persona id string into a Persona object (pure, no DB access). */
export function resolvePersona(candidate: string | undefined | null): Persona | undefined {
  if (!candidate) return undefined;
  return DEMO_PERSONAS.find((p) => p.id === candidate);
}

export function listPersonas(): DemoPersona[] {
  return [...DEMO_PERSONAS];
}
