import express from 'express';
import Setting from '../models/Setting.js';
import PortalInquiry from '../models/PortalInquiry.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

// Fallback in-memory inquiries if fallback mode active
let fallbackInquiries = [
  {
    _id: 'inq-01',
    name: 'Sarah Jenkins',
    email: 'sarah.j@example.com',
    phone: '+1 (555) 321-9876',
    studentName: 'Oliver Jenkins',
    gradeApplyingFor: 'Grade 5',
    subject: 'Admission for Academic Year 2026-27',
    message: 'We recently relocated to the city and would like to schedule a campus tour and understand the enrollment requirements for Grade 5.',
    status: 'new',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
  {
    _id: 'inq-02',
    name: 'Robert Chang',
    email: 'rchang@domain.org',
    phone: '+1 (555) 890-1234',
    studentName: 'Maya Chang',
    gradeApplyingFor: 'Kindergarten',
    subject: 'Fee Structure & Transport Inquiry',
    message: 'Hello, could you please provide details about the school bus route coverage for North Knowledge Park and the kindergarten fee schedule?',
    status: 'contacted',
    createdAt: new Date(Date.now() - 3600000 * 72).toISOString(),
  },
];

// Helper to get portal settings
const getPortalSettings = async () => {
  if (checkFallback()) {
    const raw = FallbackDb.getSettings();
    return raw?.portalSettings || {
      enabled: true,
      schoolName: raw?.schoolName || 'Iqra Public School',
      affiliation: 'Affiliated to CBSE Pattern & Modern Curriculum',
      tagline: 'Knowledge, Character & Excellence for a Better Tomorrow',
      heroImage: 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=1600&auto=format&fit=crop',
      heroSubtitle: 'At Iqra Public School Motihari, we nurture young minds with quality education, moral integrity, and modern learning tools to inspire confident future leaders.',
      admissionBadge: 'Admissions Open for Session 2026 – 2027',
      aboutTitle: 'About Iqra Public School',
      aboutDescription: 'Established with a vision to deliver value-based academic distinction, Iqra Public School provides a safe, disciplined, and stimulating atmosphere where every child in Motihari and East Champaran is encouraged to realize their highest potential.',
      directorName: 'Hasan Shahid',
      directorRole: 'Director, Iqra Public School',
      directorQuote: 'Our endeavor is to enlighten minds with beneficial knowledge and deep-rooted moral values so our children can excel in modern society with dignity and purpose.',
      directorImage: '',
      principalName: 'Dr. Zafar Iqbal',
      principalRole: 'Principal & Head of Academic Council',
      principalMessage: 'Education is not merely the transmission of facts, but the ignition of curiosity, compassion, and leadership in every young mind that walks through our gates.',
      principalImage: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=400&auto=format&fit=crop',
      socialLinks: {
        facebook: 'https://www.facebook.com/profile.php?id=100054487419314',
        youtube: 'https://www.youtube.com/@IqraPublicSchoolMotihari',
        website: 'https://www.iqrapublicschool.com',
      },
      facilities: [
        {
          title: 'Experienced Teachers',
          badge: 'Experienced',
          description: 'Passionate, certified faculty committed to student mentorship and academic success.',
          icon: 'teachers',
        },
        {
          title: 'Good Classrooms',
          badge: 'Modern',
          description: 'Spacious, climate-controlled, smart interactive digital board learning spaces.',
          icon: 'classrooms',
        },
        {
          title: 'Sports & Activities',
          badge: 'Sports & Events',
          description: 'Olympic-standard sports courts, football turf, performing arts, and annual fest.',
          icon: 'activities',
        },
      ],
      metrics: [
        { label: 'Happy Students', value: '2,500+' },
        { label: 'Qualified Teachers', value: '120+' },
        { label: 'Academic Programs', value: '20+' },
        { label: 'Years of Excellence', value: '25+' },
        { label: 'Safe & Secure Campus', value: '100%' },
      ],
      contact: {
        address: raw?.addressLine1 || 'Near Hanuman Gadhi Masjid, Nakshey Tola, Eidgah Road, Motihari, East Champaran, Bihar - 845401',
        phone: raw?.schoolPhone || '+91 94314 26252',
        alternatePhone: '+91 99342 66252',
        email: raw?.contactEmail || 'info@iqrapublicschool.com',
        admissionsEmail: 'admissions@iqrapublicschool.com',
        timing: 'Monday – Thursday: 09:00 AM – 02:30 PM | Friday: 09:00 AM – 11:00 AM | Saturday: 09:00 AM – 02:00 PM',
      },
    };
  }

  let settings = await Setting.findOne();
  if (!settings) {
    settings = await Setting.create({});
  }

  const ps = settings.portalSettings || {};
  return {
    enabled: ps.enabled ?? true,
    schoolName: ps.schoolName || settings.schoolName || 'Iqra Public School',
    schoolLogo: settings.companyLogo || settings.schoolLogo || '',
    affiliation: ps.affiliation || 'Affiliated to CBSE Pattern & Modern Curriculum',
    affiliationCode: ps.affiliationCode || 'SCH-2026-CBSE-845401',
    tagline: ps.tagline || 'Knowledge, Character & Excellence for a Better Tomorrow',
    heroImage: ps.heroImage || 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=1600&auto=format&fit=crop',
    heroSubtitle: ps.heroSubtitle || 'At Iqra Public School Motihari, we nurture young minds with quality education, moral integrity, and modern learning tools to inspire confident future leaders.',
    admissionBadge: ps.admissionBadge || 'Admissions Open for Session 2026 – 2027',
    aboutTitle: ps.aboutTitle || 'About Iqra Public School',
    aboutDescription: ps.aboutDescription || 'Established with a vision to deliver value-based academic distinction, Iqra Public School provides a safe, disciplined, and stimulating atmosphere where every child in Motihari and East Champaran is encouraged to realize their highest potential.',
    directorName: ps.directorName || 'Hasan Shahid',
    directorRole: ps.directorRole || 'Director, Iqra Public School',
    directorQuote: ps.directorQuote || 'Our endeavor is to enlighten minds with beneficial knowledge and deep-rooted moral values so our children can excel in modern society with dignity and purpose.',
    directorImage: ps.directorImage || '',
    principalName: ps.principalName || 'Dr. Zafar Iqbal',
    principalRole: ps.principalRole || 'Principal & Head of Academic Council',
    principalMessage: ps.principalMessage || 'Education is not merely the transmission of facts, but the ignition of curiosity, compassion, and leadership in every young mind that walks through our gates.',
    principalImage: ps.principalImage || 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=400&auto=format&fit=crop',
    facilities: ps.facilities && ps.facilities.length > 0 ? ps.facilities : [
      {
        title: 'Experienced Teachers',
        badge: 'Experienced',
        description: 'Passionate, certified faculty committed to student mentorship and academic success.',
        icon: 'teachers',
        gradient: 'from-blue-500 to-indigo-600',
      },
      {
        title: 'Good Classrooms',
        badge: 'Modern',
        description: 'Spacious, climate-controlled, smart interactive digital board learning spaces.',
        icon: 'classrooms',
        gradient: 'from-emerald-500 to-teal-600',
      },
      {
        title: 'Sports & Activities',
        badge: 'Sports & Events',
        description: 'Olympic-standard sports courts, football turf, performing arts, and annual fest.',
        icon: 'activities',
        gradient: 'from-amber-500 to-orange-600',
      },
    ],
    extendedFacilities: ps.extendedFacilities && ps.extendedFacilities.length > 0 ? ps.extendedFacilities : [
      {
        title: 'AI & Robotics Laboratories',
        desc: 'Coding, AI literacy, 3D printing and STEM robotics workstations.',
        icon: 'compass',
      },
      {
        title: 'Central Media Library',
        desc: 'Over 15,000 physical volumes and digital academic research journals.',
        icon: 'book',
      },
      {
        title: 'GPS-Tracked Safe Transport',
        desc: 'Climate-controlled bus fleet with real-time GPS tracking and trained attendants.',
        icon: 'bus',
      },
    ],
    metrics: ps.metrics && ps.metrics.length > 0 ? ps.metrics : [
      { label: 'Happy Students', value: '1,500+' },
      { label: 'Board Exam Distinction', value: '98.8%' },
      { label: 'Experienced Teachers', value: '50+' },
      { label: 'Sports & Clubs', value: '25+' },
    ],
    notices: ps.notices && ps.notices.length > 0 ? ps.notices : [
      {
        title: 'Admissions Open for Academic Year 2026-2027 (Limited Seats Available)',
        date: 'Sep 05, 2026',
        tag: 'Admissions',
        urgent: true,
      },
      {
        title: 'Annual Inter-School Robotics & STEM Innovation Fair Next Friday',
        date: 'Sep 12, 2026',
        tag: 'Events',
        urgent: false,
      },
      {
        title: 'Term 1 Comprehensive Assessment Schedule & Parent-Teacher Meeting',
        date: 'Sep 20, 2026',
        tag: 'Academic',
        urgent: false,
      },
    ],
    academicWings: ps.academicWings && ps.academicWings.length > 0 ? ps.academicWings : [
      {
        title: 'Pre-Primary Wing (Early Years)',
        grades: 'Playgroup to Kindergarten (Ages 3 – 5)',
        tag: 'Play & Discovery',
        description: 'A safe, sensory-rich play-based curriculum focusing on social skills, phonics, and motor coordination.',
        subjects: ['Phonics & Pre-Reading', 'Sensory Play & Art', 'Numbers & Shapes', 'Music & Movement'],
      },
      {
        title: 'Primary School Wing',
        grades: 'Grades 1 to 5 (Ages 6 – 10)',
        tag: 'Foundations & Inquiry',
        description: 'Building strong conceptual understanding in mathematics, languages, science, and collaborative projects.',
        subjects: ['Core Mathematics', 'English Language Arts', 'General Science', 'Social Studies'],
      },
      {
        title: 'Middle School Wing',
        grades: 'Grades 6 to 8 (Ages 11 – 13)',
        tag: 'Exploration & Analysis',
        description: 'Transitioning into independent analytical thinking, hands-on scientific experiments, and computer coding.',
        subjects: ['Physics, Chemistry, Biology', 'Advanced Algebra', 'Python & Digital Skills', 'Debate & World Cultures'],
      },
      {
        title: 'Senior Secondary Wing',
        grades: 'Grades 9 to 12 (Ages 14 – 18)',
        tag: 'Career & College Prep',
        description: 'Pre-university streams (Science, Commerce, Humanities) guided by experienced board educators.',
        subjects: ['Science: PCM / PCB', 'Commerce & Accountancy', 'Humanities & Social Sciences', 'SAT / College Counseling'],
      },
    ],
    admissionSteps: ps.admissionSteps && ps.admissionSteps.length > 0 ? ps.admissionSteps : [
      {
        step: '01',
        title: 'Submit Online Inquiry',
        subtitle: 'Quick & Transparent',
        description: 'Fill out the simple admission inquiry form online. Our academic counselors will contact you within 24 hours.',
        badge: 'Step 1: Get Started',
      },
      {
        step: '02',
        title: 'Campus Tour & Assessment',
        subtitle: 'Discover & Interact',
        description: 'Experience our classrooms, sports complex, and labs. Students participate in a friendly, age-appropriate conversation.',
        badge: 'Step 2: Experience',
      },
      {
        step: '03',
        title: 'Enrollment & Welcome',
        subtitle: 'Join the Family',
        description: 'Finalize document verification, receive your ERP parent credentials, uniform kit, and attend orientation!',
        badge: 'Step 3: Welcome',
      },
    ],
    ageCriteria: ps.ageCriteria && ps.ageCriteria.length > 0 ? ps.ageCriteria : [
      { grade: 'Pre-Nursery / Playgroup', age: '2.5 – 3 Years', cutoff: 'As of March 31, 2026' },
      { grade: 'Kindergarten 1 (LKG)', age: '3.5 – 4 Years', cutoff: 'As of March 31, 2026' },
      { grade: 'Kindergarten 2 (UKG)', age: '4.5 – 5 Years', cutoff: 'As of March 31, 2026' },
      { grade: 'Grade 1', age: '5.5 – 6.5 Years', cutoff: 'As of March 31, 2026' },
      { grade: 'Grade 2 to Grade 5', age: 'Age appropriate + Report card', cutoff: 'Subject to seat availability' },
      { grade: 'Grade 6 to Grade 10', age: 'Diagnostic assessment & interview', cutoff: 'Subject to seat availability' },
    ],
    documents: ps.documents && ps.documents.length > 0 ? ps.documents : [
      'Child’s Official Birth Certificate (Municipal copy)',
      'Recent passport-sized color photographs of student (4 copies)',
      'Photographs of Parents / Guardians (2 copies each)',
      'Academic progress report card from previous school',
      'Original Transfer Certificate (TC)',
      'Proof of residential address',
      'Immunization medical record',
    ],
    galleryItems: ps.galleryItems && ps.galleryItems.length > 0 ? ps.galleryItems : [
      {
        id: 1,
        title: 'Smart Digital Classrooms',
        category: 'classrooms',
        tag: 'Interactive Tech',
        img: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=800&auto=format&fit=crop',
      },
      {
        id: 2,
        title: 'Advanced Science & Robotics Lab',
        category: 'academics',
        tag: 'Innovation & STEM',
        img: 'https://images.unsplash.com/photo-1562774053-701939374585?q=80&w=800&auto=format&fit=crop',
      },
      {
        id: 3,
        title: 'Annual Athletics & Football Field',
        category: 'sports',
        tag: 'Sports Complex',
        img: 'https://images.unsplash.com/photo-1577495508048-b635879837f1?q=80&w=800&auto=format&fit=crop',
      },
      {
        id: 4,
        title: 'Creative Performing Arts Center',
        category: 'cultural',
        tag: 'Music & Drama',
        img: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?q=80&w=800&auto=format&fit=crop',
      },
    ],
    faqs: ps.faqs && ps.faqs.length > 0 ? ps.faqs : [
      {
        q: 'What curriculum and accreditation does the school follow?',
        a: 'Our school follows a globally benchmarked dual curriculum combining high academic standards with STEM, humanities, and practical project-based learning.',
        tag: 'Curriculum',
      },
      {
        q: 'How does the school ensure student safety and campus security?',
        a: 'We maintain 24/7 CCTV surveillance, biometric security gates, verified background checks for all faculty, and GPS-tracked school transport.',
        tag: 'Safety & Security',
      },
      {
        q: 'What is the teacher-to-student ratio in classrooms?',
        a: 'We maintain an optimal ratio of 1:18 to ensure every child receives personalized attention, guidance, and emotional support.',
        tag: 'Faculty & Mentorship',
      },
      {
        q: 'What sports and extracurricular activities are offered?',
        a: 'Students can participate in football, swimming, cricket, robotics, music, drama, debate, chess, and international Model UN conferences.',
        tag: 'Sports & Arts',
      },
    ],
    milestones: ps.milestones && ps.milestones.length > 0 ? ps.milestones : [
      { year: '2004', title: 'Campus Founded', desc: 'Started with 120 students and a vision for holistic schooling.' },
      { year: '2012', title: 'STEM & Robotics Hub', desc: 'Introduced 3D printing and coding for middle schoolers.' },
      { year: '2018', title: 'National Sports Award', desc: 'Recognized for top sporting infrastructure in the state.' },
      { year: '2026', title: 'Global Dual Accreditation', desc: 'Now serving over 1,500 students with 100% board distinctions.' },
    ],
    departments: ps.departments && ps.departments.length > 0 ? ps.departments : [
      {
        title: 'Admissions & Campus Tours',
        phone: '+91 94314 26252',
        email: 'admissions@iqrapublicschool.com',
        hours: 'Mon – Sat: 9:00 AM – 2:30 PM',
      },
      {
        title: 'Principal & Academic Office',
        phone: '+91 99342 66252',
        email: 'principal@iqrapublicschool.com',
        hours: 'By prior appointment only',
      },
      {
        title: 'Transport & Safety Helpline',
        phone: '+91 94314 26252',
        email: 'transport@iqrapublicschool.com',
        hours: '7:00 AM – 3:00 PM on school days',
      },
    ],
    leadership: ps.leadership && ps.leadership.length > 0 ? ps.leadership : [
      {
        name: 'Hasan Shahid',
        role: 'Director, Iqra Public School',
        degrees: 'Educational Visionary & Founder',
        quote: 'Our endeavor is to enlighten minds with beneficial knowledge and deep-rooted moral values so our children can excel in modern society with dignity and purpose.',
      },
      {
        name: 'Dr. Zafar Iqbal',
        role: 'Principal & Head of Academic Council',
        degrees: 'Ph.D. Education, Senior Academician',
        quote: 'Education is not merely the transmission of facts, but the ignition of curiosity, compassion, and leadership in every young mind that walks through our gates.',
      },
      {
        name: 'Senior Academic Faculty',
        role: 'Head of Curriculum & Student Mentorship',
        degrees: 'CBSE Pedagogy Experts & Master Teachers',
        quote: 'A warm, disciplined, and stimulating atmosphere where every child in Motihari is encouraged to realize their highest potential.',
      },
    ],
    socialLinks: ps.socialLinks || {
      facebook: 'https://www.facebook.com/profile.php?id=100054487419314',
      youtube: 'https://www.youtube.com/@IqraPublicSchoolMotihari',
      website: 'https://www.iqrapublicschool.com',
    },
    contact: {
      address: ps.contact?.address || settings.addressLine1 || 'Near Hanuman Gadhi Masjid, Nakshey Tola, Eidgah Road, Motihari, East Champaran, Bihar - 845401',
      phone: ps.contact?.phone || settings.schoolPhone || '+91 94314 26252',
      alternatePhone: ps.contact?.alternatePhone || '+91 99342 66252',
      email: ps.contact?.email || settings.contactEmail || 'info@iqrapublicschool.com',
      admissionsEmail: ps.contact?.admissionsEmail || 'admissions@iqrapublicschool.com',
      timing: ps.contact?.timing || 'Monday – Thursday: 09:00 AM – 02:30 PM | Friday: 09:00 AM – 11:00 AM | Saturday: 09:00 AM – 02:00 PM',
    },
  };
};

// 1. Public Endpoint to get portal content
router.get('/public', async (req, res) => {
  try {
    const portal = await getPortalSettings();
    return res.json({
      success: true,
      portal,
    });
  } catch (err) {
    console.error('Portal public settings error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve portal data' });
  }
});

// 1b. Admin: Update portal settings directly
router.put('/settings', protect, authorize('super-admin', 'school-admin', 'principal'), async (req, res) => {
  try {
    const portalData = req.body;
    if (checkFallback()) {
      const prev = FallbackDb.getSettings();
      const updated = {
        ...prev,
        portalSettings: {
          ...(prev?.portalSettings || {}),
          ...portalData,
        },
      };
      FallbackDb.updateSettings(updated);
      return res.json({ success: true, message: 'Portal settings saved', portal: updated.portalSettings });
    }

    let settings = await Setting.findOne();
    if (!settings) {
      settings = new Setting({});
    }

    settings.portalSettings = {
      ...(settings.portalSettings || {}),
      ...portalData,
    };
    await settings.save();

    return res.json({ success: true, message: 'Portal settings saved', portal: settings.portalSettings });
  } catch (err) {
    console.error('Portal settings update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update portal settings' });
  }
});

// 2. Public Endpoint for visitors to submit inquiry
router.post('/inquiry', async (req, res) => {
  try {
    const { name, email, phone, studentName, gradeApplyingFor, subject, message } = req.body;

    if (!name || !email || !phone || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, phone, and message are required fields.',
      });
    }

    if (checkFallback()) {
      const newInq = {
        _id: `inq-${Date.now()}`,
        name,
        email,
        phone,
        studentName: studentName || '',
        gradeApplyingFor: gradeApplyingFor || 'Grade 1',
        subject: subject || 'General Admission Inquiry',
        message,
        status: 'new',
        createdAt: new Date().toISOString(),
      };
      fallbackInquiries.unshift(newInq);
      return res.status(201).json({
        success: true,
        message: 'Thank you! Your inquiry has been received. Our admissions team will contact you shortly.',
        inquiry: newInq,
      });
    }

    const inquiry = await PortalInquiry.create({
      name,
      email,
      phone,
      studentName,
      gradeApplyingFor,
      subject,
      message,
    });

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your inquiry has been received. Our admissions team will contact you shortly.',
      inquiry,
    });
  } catch (err) {
    console.error('Portal inquiry error:', err);
    return res.status(500).json({ success: false, message: 'Server error processing inquiry' });
  }
});

// 3. Admin: Get all inquiries
router.get('/inquiries', protect, authorize('super-admin', 'school-admin', 'principal'), async (req, res) => {
  try {
    if (checkFallback()) {
      return res.json({
        success: true,
        inquiries: fallbackInquiries,
      });
    }

    const inquiries = await PortalInquiry.find().sort({ createdAt: -1 });
    return res.json({
      success: true,
      inquiries,
    });
  } catch (err) {
    console.error('Get inquiries error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching inquiries' });
  }
});

// 4. Admin: Update inquiry status / notes
router.patch('/inquiries/:id', protect, authorize('super-admin', 'school-admin', 'principal'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (checkFallback()) {
      const inq = fallbackInquiries.find((i) => i._id === id);
      if (inq) {
        if (status) inq.status = status;
        if (adminNotes !== undefined) inq.adminNotes = adminNotes;
      }
      return res.json({ success: true, inquiry: inq });
    }

    const updated = await PortalInquiry.findByIdAndUpdate(
      id,
      { ...(status && { status }), ...(adminNotes !== undefined && { adminNotes }) },
      { new: true }
    );

    return res.json({ success: true, inquiry: updated });
  } catch (err) {
    console.error('Update inquiry error:', err);
    return res.status(500).json({ success: false, message: 'Server error updating inquiry' });
  }
});

// 5. Admin: Delete an inquiry
router.delete('/inquiries/:id', protect, authorize('super-admin', 'school-admin', 'principal'), async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      fallbackInquiries = fallbackInquiries.filter((i) => i._id !== id);
      return res.json({ success: true, message: 'Inquiry deleted successfully' });
    }

    await PortalInquiry.findByIdAndDelete(id);
    return res.json({ success: true, message: 'Inquiry deleted successfully' });
  } catch (err) {
    console.error('Delete inquiry error:', err);
    return res.status(500).json({ success: false, message: 'Server error deleting inquiry' });
  }
});

export default router;
