import { firestore } from "firebase-admin";

export type UserRole = "mentor" | "mentee" | "admin";

export interface UserDoc {
  role: UserRole;
  fullName: string;
  email: string;
  isAdmin: boolean;
  createdAt: firestore.Timestamp;
}

export type Availability = "available" | "unavailable";

export interface MentorProfile {
  userId: string;
  fullName: string;
  email: string;
  currentRole: string | null;
  company: string | null;
  expertise: string[];
  yearsExperience: number | null;
  availability: Availability;
  linkedIn: string | null;
  calendlyUrl: string | null;
  createdAt: firestore.Timestamp;
  updatedAt: firestore.Timestamp;
}

export interface MenteeProfile {
  userId: string;
  fullName: string;
  email: string;
  experienceLevel: string | null;
  interests: string[];
  goals: string | null;
  createdAt: firestore.Timestamp;
  updatedAt: firestore.Timestamp;
}

export type RequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "needs_info"
  | "completed";

export interface MentorshipRequest {
  menteeId: string;
  mentorId: string;
  menteeName: string;
  mentorName: string;
  topic: string;
  description: string | null;
  status: RequestStatus;
  mentorResponse: string | null;
  createdAt: firestore.Timestamp;
  updatedAt: firestore.Timestamp;
}

export interface Topic {
  name: string;
}

export type NotificationType = "new_request" | "request_response";

export interface NotificationDoc {
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: firestore.Timestamp;
  requestId?: string;
}
