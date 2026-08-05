/**
 * Bundled house-style templates.
 *
 * The prototype made the consultant pick both files off disk on every run,
 * which meant two consultants could produce differently-styled quotes from
 * the same tool depending on which copy of the template they happened to
 * have. Bundling them makes the repo the single source of house style — the
 * same posture AD-13 takes for the install assessment's styles part.
 *
 * Replacing either file rebrands the corresponding output.
 *
 * Imported as URLs and fetched on demand so the ~55 kB of binary stays out
 * of the main bundle. Kept out of the writer modules so the writers remain
 * pure functions over bytes and can be tested by reading the template from
 * disk.
 */

import labmatTemplateUrl from './templates/blank-bia-labmat.xlsx?url';
import checklistTemplateUrl from './templates/blank-checklist.docx?url';

async function load(url: string, what: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load the bundled ${what} template (${response.status}).`);
  }
  return response.arrayBuffer();
}

export function loadBundledLabmatTemplate(): Promise<ArrayBuffer> {
  return load(labmatTemplateUrl, 'LabMat');
}

export function loadBundledChecklistTemplate(): Promise<ArrayBuffer> {
  return load(checklistTemplateUrl, 'CheckList');
}
