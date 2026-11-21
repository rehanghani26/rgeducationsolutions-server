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
