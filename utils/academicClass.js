const standardNames = ['Nursery', 'LKG', 'UKG', ...Array.from({ length: 12 }, (_, index) => 'Class ' + (index + 1))];
const standardCodes = ['cls-nur', 'cls-lkg', 'cls-ukg', ...Array.from({ length: 12 }, (_, index) => 'cls-' + (index + 1))];

export const sectionNamesById = {
  'sec-a': 'Section A', 'sec-b': 'Section B', 'sec-c': 'Section C',
  'sec-d': 'Section D', 'sec-e': 'Section E', 'sec-f': 'Section F',
  'sec-g': 'Section G',
};

export const standardGrades = standardNames.map((name, index) => ({
  name, code: standardCodes[index], sortOrder: index * 10,
}));

export const classKey = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function standardGrade(value) {
  const key = classKey(value);
  const gradeNumber = /^(?:cls-|class\s*|grade\s*)?(\d+)$/.exec(key);
  return standardGrades.find(({ name, code }) =>
    [classKey(name), code].includes(key) || (gradeNumber && code === 'cls-' + Number(gradeNumber[1]))
  );
}

export function gradeByValue(grades, value) {
  const key = classKey(value?._id || value?.id || value);
  if (!key) return null;
  return grades.find((grade) => classKey(grade.id) === key)
    || grades.find((grade) => [grade.code, grade.name, ...(grade.aliases || [])].some((alias) => classKey(alias) === key))
    || null;
}

/**
 * Resolves a section string or object to a canonical { id, name, standard } descriptor.
 *
 * @param {string|Object} value - Section identifier or display name (e.g., "sec-a", "Section A", "A").
 * @returns {{ id: string, name: string, standard: boolean }|null}
 */
export function sectionByValue(value) {
  const raw = value && typeof value === 'object' ? value._id || value.id || value.name : value;
  const text = String(raw ?? '').trim();
  const key = classKey(text);
  if (!key || /^(?:all(?:\s+sections?)?|section_id|n\/a|null|undefined)$/.test(key)) return null;
  for (const [id, name] of Object.entries(sectionNamesById)) {
    if (classKey(id) === key || classKey(name) === key) return { id, name, standard: true };
  }
  const match = /^(?:sec-|section\s*)?([a-z])$/.exec(key);
  if (match) {
    const letter = match[1].toLowerCase();
    const id = `sec-${letter}`;
    return { id, name: sectionNamesById[id] || `Section ${letter.toUpperCase()}`, standard: true };
  }
  return { id: key, name: text, standard: false };
}

/**
 * Checks whether an enrollment or record belongs to the requested section.
 *
 * @param {string|Object|null} target - Requested section identifier, name, or descriptor.
 * @param {Object|null} enrollment - Student enrollment or attendance record.
 * @returns {boolean}
 */
export function sectionMatches(target, enrollment) {
  const resolvedTarget = sectionByValue(target);
  if (!resolvedTarget) return true;
  const candidates = [enrollment?.sectionId, enrollment?.sectionName, enrollment?.section]
    .map((item) => sectionByValue(item))
    .filter(Boolean);
  if (!candidates.length) return false;
  return candidates.some((candidate) =>
    candidate.id === resolvedTarget.id || classKey(candidate.name) === classKey(resolvedTarget.name)
  );
}

/**
 * Extracts and canonicalizes sectionId and sectionName from request inputs.
 *
 * @param {string|Object} [sectionId]
 * @param {string} [sectionName]
 * @param {string} [classSection]
 * @returns {{ sectionId: string|undefined, sectionName: string|undefined, resolved: Object|null }}
 */
export function canonicalSectionDescriptor(sectionId, sectionName, classSection) {
  const cleanId =
    typeof sectionId === 'string' && /^SECTION_ID$/i.test(sectionId.trim()) ? '' : sectionId;
  const splitSection = String(classSection || '').split(/\s+[–—-]\s+/);
  const classSectionPart =
    splitSection.length >= 2 ? splitSection.slice(1).join(' - ').trim() : '';
  const rawSection = cleanId || sectionName || classSectionPart;
  const resolved = sectionByValue(rawSection);
  if (!resolved) {
    return {
      sectionId: cleanId ? String(cleanId).trim() : undefined,
      sectionName: sectionName ? String(sectionName).trim() : undefined,
      resolved: null,
    };
  }
  if (resolved.standard) {
    return { sectionId: resolved.id, sectionName: resolved.name, resolved };
  }
  return {
    sectionId: cleanId ? String(cleanId).trim() : resolved.id,
    sectionName: sectionName ? String(sectionName).trim() : resolved.name,
    resolved,
  };
}
