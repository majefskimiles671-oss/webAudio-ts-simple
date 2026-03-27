// src/ui/UIElements.ts
export const $ = (sel: string) =>
  document.querySelector(sel) as HTMLElement;
export const $$ = (sel: string) =>
  Array.from(document.querySelectorAll(sel)) as HTMLElement[];