import { randomUUID } from 'node:crypto';
import { academicError, academicGrade } from '../utils/academicScope.js';
import { classKey, gradeByValue } from '../utils/academicClass.js';
import { cleanText } from '../utils/procurementValues.js';
import tenantContext from '../utils/tenantContext.js';
import { readProcurement } from './procurementStore.js';
import {
  academicsScope, canManageAcademics, checkRevision, idOf, isFaculty,
  linkedStudents, requireAcademicAccess, roleOf, writeAcademics,
} from './academicsAccess.js';

export async function findClassSyllabus(store, scope, grade) {
  const match = { sessionId: scope.sessionId };
  const record = await store.one('syllabus', { ...match, classId: grade.id });
  if (record) return record;
  const matches = (await store.find('syllabus', match)).filter((row) =>
    gradeByValue(scope.grades, row.classId || row.className)?.id === grade.id);
  if (matches.length > 1) throw academicError('Multiple older syllabus records match this class. Review them before editing.', 409);
  return matches[0] || null;
}

export function publishedSyllabus(record) {
  if (!record?.published) return null;
  const { version, description, subjects, publishedAt } = record.published;
  return {
    classId: record.classId,
    className: record.className,
    academicYear: record.academicYear,
    version, description, subjects, publishedAt,
  };
}

function draftSubjects(record, catalog) {
  return (record?.subjects || []).map((row) => {
    const matches = catalog.filter((subject) => row.subjectId
      ? idOf(subject) === idOf(row.subjectId)
      : row.subjectCode
        ? classKey(subject.code) === classKey(row.subjectCode)
        : classKey(subject.name) === classKey(row.subjectName));
    return {
      ...row,
      subjectId: matches.length === 1 ? idOf(matches[0]) : '',
      books: row.books || (row.bookName ? [{
        title: row.bookName, author: row.author, publisher: row.publisher, required: true,
      }] : []),
      chapters: row.chapters || [],
    };
  });
}

export async function readSyllabusDraft(req, classId) {
  requireAcademicAccess(canManageAcademics(req));
  const scope = academicsScope();
  const grade = academicGrade(scope, classId);
  const store = readProcurement(req);
  const [record, subjects, books] = await Promise.all([
    findClassSyllabus(store, scope, grade), store.find('subjects'), store.find('books'),
  ]);
  return {
    draft: { ...(record || {}), classId: grade.id, className: grade.name, subjects: draftSubjects(record, subjects) },
    subjects: subjects.map(({ _id, id, name, code }) => ({ id: idOf(_id || id), name, code })),
    books: books.map(({ _id, id, title, author, isbn }) => ({ id: idOf(_id || id), title, author, isbn })),
  };
}

export async function readPublishedSyllabuses(req, classId) {
  const role = roleOf(req);
  const personal = ['student', 'parent'].includes(role);
  requireAcademicAccess(personal || canManageAcademics(req) || isFaculty(req) || role === 'librarian');
  const scope = academicsScope();
  const store = readProcurement(req);
  let gradeIds = new Set(scope.grades.map(({ id }) => id));
  if (personal) {
    const students = await linkedStudents(store, req);
    const enrollments = await Promise.all(students.map((student) => store.one('studentSessionHistories', {
      sessionId: scope.sessionId, studentId: idOf(student),
    })));
    gradeIds = new Set(enrollments.filter(Boolean).map(({ classId: enrolledClass }) => idOf(enrolledClass)));
  }
  const grade = classId ? academicGrade(scope, classId) : null;
  if (grade) requireAcademicAccess(gradeIds.has(grade.id));
  const rows = await store.find('syllabus', { sessionId: scope.sessionId });
  const published = rows.filter((row) => gradeIds.has(idOf(row.classId))).map(publishedSyllabus).filter(Boolean);
  return grade ? { syllabus: published.find((row) => idOf(row.classId) === grade.id) || null } : { syllabuses: published };
}

function requireList(value, limit, label) {
  if (!Array.isArray(value) || value.length > limit) throw academicError('Check the ' + label + ' list.');
  return value;
}

export function requireTitle(value, label, max = 160) {
  const title = cleanText(value);
  if (!title || title.length > max) throw academicError(label + ' is required and must be at most ' + max + ' characters.');
  return title;
}

function normalizeSubjects(input, catalog, books) {
  const subjectById = new Map(catalog.map((subject) => [idOf(subject), subject]));
  const bookById = new Map(books.map((book) => [idOf(book), book]));
  const seen = new Set();
  const chapterIds = new Set();
  return requireList(input, 60, 'subject').map((row) => {
    const subject = subjectById.get(cleanText(row?.subjectId));
    if (!subject || seen.has(idOf(subject))) throw academicError('Select each subject once from Subject Master.');
    seen.add(idOf(subject));
    const maxMarks = Number(row.maxMarks);
    const passMarks = Number(row.passMarks);
    if (row.passMarks == null || row.passMarks === '' || !Number.isFinite(maxMarks) || !Number.isFinite(passMarks)
      || maxMarks <= 0 || maxMarks > 1000 || passMarks < 0 || passMarks > maxMarks) {
      throw academicError('Enter valid full and pass marks for ' + subject.name + '.');
    }
    const prescribed = requireList(row.books || [], 30, 'book').map((book) => {
      const catalogBookId = cleanText(book?.catalogBookId);
      if (catalogBookId && !bookById.has(catalogBookId)) throw academicError('Choose a book from this school’s library catalog.');
      return {
        title: requireTitle(book?.title, 'Book title'), author: cleanText(book.author).slice(0, 120),
        publisher: cleanText(book.publisher).slice(0, 120), edition: cleanText(book.edition).slice(0, 80),
        isbn: cleanText(book.isbn).slice(0, 30), required: book.required !== false, catalogBookId,
      };
    });
    const chapters = requireList(row.chapters || [], 150, 'chapter').map((chapter) => {
      const id = cleanText(chapter?.id) || randomUUID();
      if (!/^[a-z0-9-]{1,64}$/i.test(id) || chapterIds.has(id)) throw academicError('Each chapter needs a unique reference.');
      chapterIds.add(id);
      return { id, title: requireTitle(chapter?.title, 'Chapter title'), term: cleanText(chapter.term).slice(0, 80) };
    });
    const primaryBook = prescribed.find((book) => book.required) || prescribed[0];
    return {
      subjectId: idOf(subject), subjectName: subject.name, subjectCode: subject.code,
      maxMarks, passMarks, books: prescribed, chapters,
      bookName: primaryBook?.title || '', author: primaryBook?.author || '', publisher: primaryBook?.publisher || '',
    };
  });
}

export async function saveSyllabusDraft(req, classId) {
  requireAcademicAccess(canManageAcademics(req));
  const scope = academicsScope();
  const grade = academicGrade(scope, classId);
  const { revision, description, subjects } = req.body;
  return writeAcademics(req, scope, ['syllabus', 'subjects', 'books'], async (store) => {
    const record = await findClassSyllabus(store, scope, grade);
    checkRevision(record, revision);
    const normalized = normalizeSubjects(subjects, await store.find('subjects'), await store.find('books'));
    const data = {
      classId: grade.id, className: grade.name, academicYear: scope.session.sessionName,
      description: cleanText(description).slice(0, 1000), subjects: normalized,
      status: 'draft', reviewNote: '', revision: revision + 1,
    };
    return record
      ? store.update('syllabus', idOf(record), data)
      : store.create('syllabus', { ...data, sessionId: scope.sessionId });
  });
}

export async function changeSyllabusStatus(req, classId) {
  requireAcademicAccess(canManageAcademics(req));
  const scope = academicsScope();
  const grade = academicGrade(scope, classId);
  const { action, revision, note } = req.body;
  return writeAcademics(req, scope, ['syllabus', 'subjects', 'books'], async (store) => {
    const record = await findClassSyllabus(store, scope, grade);
    checkRevision(record, revision);
    if (!record?.subjects?.length) throw academicError('Add at least one subject and save the draft.');
    const changes = { revision: revision + 1 };
    if (action === 'submit' && record.status === 'draft') {
      changes.status = 'in-review';
    } else if (action === 'return' && record.status === 'in-review') {
      changes.status = 'draft';
      changes.reviewNote = requireTitle(note, 'Review note', 500);
    } else if (action === 'publish' && record.status === 'in-review') {
      const subjects = normalizeSubjects(record.subjects, await store.find('subjects'), await store.find('books'));
      changes.status = 'published';
      changes.reviewNote = '';
      changes.published = {
        version: (record.published?.version || 0) + 1, description: record.description, subjects,
        publishedAt: new Date(), publishedBy: idOf(req.user?.userId || req.user),
      };
      if (record.published) changes.history = [...(record.history || []), record.published];
    } else {
      throw academicError('This action is unavailable for the current syllabus status.', 409);
    }
    return store.update('syllabus', idOf(record), changes);
  });
}

export async function copyPublishedSyllabus(req, classId) {
  requireAcademicAccess(canManageAcademics(req));
  const scope = academicsScope();
  const grade = academicGrade(scope, classId);
  const sourceId = cleanText(req.query.sourceSessionId);
  const context = tenantContext.getStore();
  const source = await tenantContext.run({ ...context, academicScope: null }, async () => {
    const store = readProcurement(req);
    const session = await store.get('academicSessions', sourceId);
    if (!session || session.status !== 'completed' || sourceId === scope.sessionId) {
      throw academicError('Choose a completed session to copy from.');
    }
    return store.one('syllabus', { sessionId: sourceId, classId: grade.id });
  });
  if (!source?.published) throw academicError('This class has no published syllabus in that session.', 404);
  return { description: source.published.description, subjects: source.published.subjects };
}
