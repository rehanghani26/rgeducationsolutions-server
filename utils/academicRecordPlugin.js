import mongoose from 'mongoose';
import { academicError, academicFields, getAcademicScope } from './academicScope.js';

export default function academicRecordPlugin(schema, { collection }) {
  if (!schema.path('sessionId')) {
    schema.add({ sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', immutable: true } });
  }
  if (!schema.path('classId') && ['fees', 'leaveRequests', 'leaves', 'issuedCertificates',
    'curriculums', 'library', 'transportAssignments', 'hostelOccupancies', 'notices', 'notifications'].includes(collection)) {
    schema.add({ classId: { type: String } });
  }
  schema.index({ schoolId: 1, sessionId: 1, ...(schema.path('classId') ? { classId: 1 } : {}) });

  schema.pre('validate', function () {
    const scope = getAcademicScope();
    if (!scope) return;
    if (!this.isNew && !this.isModified()) return;
    if (!this.isNew && String(this.sessionId || '') !== scope.sessionId) {
      throw academicError('The record belongs to a different academic session.', 409);
    }
    const data = this.toObject();
    this.set(academicFields(scope, collection, data, { creating: this.isNew }));
  });

  const reads = ['find', 'findOne', 'count', 'countDocuments'];
  const writes = ['findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany'];
  schema.pre([...reads, ...writes], function () {
    const scope = getAcademicScope();
    if (!scope) return;
    const isWrite = writes.includes(this.op);
    if (isWrite && scope.readOnly) throw academicError('This academic session is read-only.', 409);
    const sessionId = scope.legacy ? null : scope.sessionId;
    this.setQuery({ $and: [this.getFilter(), { schoolId: scope.schoolId, sessionId }] });
    const update = isWrite && this.getUpdate();
    if (!update) return;
    if (Array.isArray(update)) throw academicError('Unsupported academic update.');
    const isOperator = Object.keys(update).some((key) => key.startsWith('$'));
    const input = isOperator ? { ...update.$setOnInsert, ...update.$set } : update;
    const upserting = Boolean(this.getOptions().upsert);
    const fields = academicFields(scope, collection, input, { creating: upserting });
    if (isOperator) {
      for (const [operator, values] of Object.entries(update)) {
        if (operator !== '$setOnInsert' && values && Object.keys(values).some((key) => key === 'sessionId' || key === 'schoolId')) {
          throw academicError('The school and session of an academic record are fixed.');
        }
      }
      const { sessionId: insertedSession, ...changes } = fields;
      if (Object.keys(changes).length) update.$set = { ...update.$set, ...changes };
      if (upserting) update.$setOnInsert = { ...update.$setOnInsert, schoolId: scope.schoolId, sessionId: insertedSession };
    } else {
      Object.assign(update, fields);
      if (!upserting) delete update.sessionId;
      delete update.schoolId;
      if (upserting) update.schoolId = scope.schoolId;
    }
    this.setUpdate(update);
  });

  schema.pre('aggregate', function () {
    const scope = getAcademicScope();
    if (!scope) return;
    const sessionId = scope.legacy ? null : new mongoose.Types.ObjectId(scope.sessionId);
    this.pipeline().unshift({ $match: { schoolId: scope.schoolId, sessionId } });
  });
}
