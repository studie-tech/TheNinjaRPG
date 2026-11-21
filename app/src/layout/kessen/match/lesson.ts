/**
 * How the table names the controls Lemu's coach steps point at. Every control a lesson
 * can ring carries `data-lesson-target` (and `data-lesson-key` where there are several
 * of it); the steps themselves come from `academyCoach` in `@/libs/kessen/academy`.
 */
import type { AcademyTarget } from "@/libs/kessen/academy";

/** Selector of a lesson target. */
export const lessonTargetSelector = ({ target, key }: AcademyTarget) =>
  `[data-lesson-target="${target}"]${key === undefined ? "" : `[data-lesson-key="${key}"]`}`;
