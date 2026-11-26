import {
  assignHostelBed, assignHostelRoom, availableStudentBeds, changeHostelAllocation, getHostelAccess, hostelHistory, hostelWorkspace,
  reviewLegacyAllocation, saveHostel, saveHostelRoom, searchHostelStudents, studentHostel,
} from '../services/hostelService.js';
import { sendError, sendSuccess } from '../utils/responseUtil.js';

const handle = (run, status = 200) => async (req, res) => {
  try {
    return sendSuccess(res, undefined, await run(req), status);
  } catch (error) {
    if (error.code === 11000) return sendError(res, 'This hostel, room, student or bed is already assigned.', 409);
    if (error.name === 'ValidationError' || error.name === 'CastError') return sendError(res, 'Check the hostel details and try again.', 400);
    if (error.statusCode) return sendError(res, error.message, error.statusCode);
    console.error('Hostel operation failed:', error);
    return sendError(res, 'Unable to complete this hostel operation.', 500);
  }
};

export const access = handle(async (req) => {
  const { canConfigure, canManage } = await getHostelAccess(req);
  return { canConfigure, canManage };
});
export const workspace = handle(hostelWorkspace);
export const hostelSave = handle(saveHostel);
export const roomSave = handle(saveHostelRoom);
export const assignRoom = handle(assignHostelRoom);
export const history = handle(hostelHistory);
export const students = handle(searchHostelStudents);
export const availableBeds = handle(availableStudentBeds);
export const studentAllocation = handle((req) => studentHostel(req, { studentId: req.params.studentId }));
export const assign = handle(async (req) => ({ occupancy: await assignHostelBed(req) }), 201);
export const transition = (action) => handle(async (req) => ({ allocation: await changeHostelAllocation(req, action) }));
export const reviewLegacy = handle(async (req) => ({ allocation: await reviewLegacyAllocation(req) }));
export const occupancies = handle(async (req) => {
  const { student } = await getHostelAccess(req);
  if (student) {
    const { allocation } = await studentHostel(req);
    return { occupancies: allocation ? [allocation] : [] };
  }
  const { allocations } = await hostelWorkspace(req);
  return { occupancies: allocations };
});
