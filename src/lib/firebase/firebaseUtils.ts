import { auth, db } from "./firebase";
import {
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
  query,
  where,
  serverTimestamp,
  writeBatch,
  limit,
  orderBy,
  arrayUnion,
  arrayRemove,
  getCountFromServer,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { getSpaceColor } from "../theme/colors";
import { deriveTags, deriveMentions } from "../utils/textUtils";
import type { Space, Todo, Daily, TiptapContent } from "../types";
// Auth functions
export const logoutUser = () => signOut(auth);

export const signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

// Firestore functions
export const addDocument = (collectionName: string, data: any) =>
  addDoc(collection(db, collectionName), data);

export const getDocuments = async (collectionName: string) => {
  const querySnapshot = await getDocs(collection(db, collectionName));
  return querySnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
};

export const updateDocument = (collectionName: string, id: string, data: any) =>
  updateDoc(doc(db, collectionName, id), data);

export const deleteDocument = (collectionName: string, id: string) =>
  deleteDoc(doc(db, collectionName, id));

// --- Spaces (issue #40) ---
// Top-level `spaces/{spaceId}`; membership grants full access. Rights model
// (see firestore.rules): any member may read/update (rename, recolor, add/remove
// members — the "+ einladen" flow); createdBy/createdAt are immutable; only the
// creator may delete the space.

const SPACES_COLLECTION = "spaces";

// Create a space with the creator as the first member. The color is assigned
// cyclically from the design palette based on how many spaces the user already
// has, so the Nth space gets the Nth palette hue (wrapping around).
export const createSpace = async (
  uid: string,
  name: string,
  existingSpaceCount = 0
): Promise<string> => {
  if (!uid) throw new Error("User not authenticated.");
  const ref = await addDoc(collection(db, SPACES_COLLECTION), {
    name: name.trim(),
    color: getSpaceColor(existingSpaceCount).hue,
    members: [uid],
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
};

// Load every space the user is a member of (oldest first, for stable ordering).
export const getSpacesForUser = async (uid: string): Promise<Space[]> => {
  if (!uid) return [];
  const q = query(
    collection(db, SPACES_COLLECTION),
    where("members", "array-contains", uid)
  );
  const snapshot = await getDocs(q);
  const spaces = snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: typeof data.name === "string" ? data.name : "",
      color: typeof data.color === "number" ? data.color : getSpaceColor(0).hue,
      members: Array.isArray(data.members) ? data.members : [],
      createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
      createdAt: data.createdAt ?? null,
    } as Space;
  });
  // array-contains + orderBy would require a composite index, so sort client-side.
  return spaces.sort(
    (a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0)
  );
};

export const renameSpace = (spaceId: string, name: string) =>
  updateDoc(doc(db, SPACES_COLLECTION, spaceId), { name: name.trim() });

export const addSpaceMember = (spaceId: string, uid: string) =>
  updateDoc(doc(db, SPACES_COLLECTION, spaceId), { members: arrayUnion(uid) });

export const removeSpaceMember = (spaceId: string, uid: string) =>
  updateDoc(doc(db, SPACES_COLLECTION, spaceId), { members: arrayRemove(uid) });

// Only the creator may delete (enforced by firestore.rules).
export const deleteSpace = (spaceId: string) =>
  deleteDoc(doc(db, SPACES_COLLECTION, spaceId));

// --- Todos (space-scoped, issue #41) ---
// Decision: todos live under spaces/{spaceId}/todos (moved out of
// users/{uid}/todos) so every space member has full read/write access — see
// firestore.rules. tags/mentions are derived from title/body on every write.

const todosCol = (spaceId: string) =>
  collection(db, SPACES_COLLECTION, spaceId, "todos");
const todoRef = (spaceId: string, todoId: string) =>
  doc(db, SPACES_COLLECTION, spaceId, "todos", todoId);

const mapTodo = (d: QueryDocumentSnapshot<DocumentData>): Todo => {
  const data = d.data();
  return {
    id: d.id,
    spaceId: typeof data.spaceId === "string" ? data.spaceId : "",
    title: typeof data.title === "string" ? data.title : "",
    body: (data.body as TiptapContent | null) ?? null,
    completed: data.completed === true,
    waitingOn: typeof data.waitingOn === "string" ? data.waitingOn : null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    mentions: Array.isArray(data.mentions) ? data.mentions : [],
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAt: data.createdAt ?? null,
    order: typeof data.order === "number" ? data.order : 0,
  };
};

export const createTodo = async (
  spaceId: string,
  uid: string,
  input: {
    title: string;
    body?: TiptapContent | null;
    waitingOn?: string | null;
    order?: number;
  }
): Promise<string> => {
  if (!spaceId || !uid) throw new Error("Missing space or user.");
  const body = input.body ?? null;
  const ref = await addDoc(todosCol(spaceId), {
    spaceId,
    title: input.title.trim(),
    body,
    completed: false,
    waitingOn: input.waitingOn ?? null,
    tags: deriveTags(input.title, body),
    mentions: deriveMentions(body),
    createdBy: uid,
    createdAt: serverTimestamp(),
    order: input.order ?? 0,
  });
  return ref.id;
};

export const getTodosForSpace = async (spaceId: string): Promise<Todo[]> => {
  if (!spaceId) return [];
  const snapshot = await getDocs(query(todosCol(spaceId), orderBy("order", "asc")));
  return snapshot.docs.map(mapTodo);
};

// Server-side count of open (not completed) todos — drives the sidebar/pill
// "open" badge per space without fetching every todo.
export const getOpenTodoCount = async (spaceId: string): Promise<number> => {
  if (!spaceId) return 0;
  const snapshot = await getCountFromServer(
    query(todosCol(spaceId), where("completed", "==", false))
  );
  return snapshot.data().count;
};

// Edit title/body together and re-derive tags/mentions from the new content.
export const editTodoContent = (
  spaceId: string,
  todoId: string,
  title: string,
  body: TiptapContent | null
) =>
  updateDoc(todoRef(spaceId, todoId), {
    title: title.trim(),
    body,
    tags: deriveTags(title, body),
    mentions: deriveMentions(body),
  });

export const setTodoCompleted = (spaceId: string, todoId: string, completed: boolean) =>
  updateDoc(todoRef(spaceId, todoId), { completed });

export const setTodoWaitingOn = (
  spaceId: string,
  todoId: string,
  waitingOn: string | null
) => updateDoc(todoRef(spaceId, todoId), { waitingOn });

export const setTodoOrder = (spaceId: string, todoId: string, order: number) =>
  updateDoc(todoRef(spaceId, todoId), { order });

export const deleteTodo = (spaceId: string, todoId: string) =>
  deleteDoc(todoRef(spaceId, todoId));

// --- Daily "Heute" items (space-scoped, issue #41) ---
// Short-lived items, deliberately separate from todos (never appear in the list).

const dailyCol = (spaceId: string) =>
  collection(db, SPACES_COLLECTION, spaceId, "daily");
const dailyRef = (spaceId: string, dailyId: string) =>
  doc(db, SPACES_COLLECTION, spaceId, "daily", dailyId);

// Local date as YYYY-MM-DD (lexicographically comparable for "older than today").
export const todayString = (): string => {
  const d = new Date();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};

const mapDaily = (d: QueryDocumentSnapshot<DocumentData>): Daily => {
  const data = d.data();
  return {
    id: d.id,
    spaceId: typeof data.spaceId === "string" ? data.spaceId : "",
    text: typeof data.text === "string" ? data.text : "",
    completed: data.completed === true,
    date: typeof data.date === "string" ? data.date : "",
    author: typeof data.author === "string" ? data.author : "",
    createdAt: data.createdAt ?? null,
  };
};

export const createDaily = async (
  spaceId: string,
  uid: string,
  text: string,
  date: string = todayString()
): Promise<string> => {
  if (!spaceId || !uid) throw new Error("Missing space or user.");
  const ref = await addDoc(dailyCol(spaceId), {
    spaceId,
    text: text.trim(),
    completed: false,
    date,
    author: uid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
};

// Open (not completed) daily items. Single-field filter → no composite index;
// callers split into today's vs. "liegengeblieben" (date < today) client-side.
export const getOpenDailyForSpace = async (spaceId: string): Promise<Daily[]> => {
  if (!spaceId) return [];
  const snapshot = await getDocs(
    query(dailyCol(spaceId), where("completed", "==", false))
  );
  return snapshot.docs
    .map(mapDaily)
    .sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
};

// "Liegengeblieben": an open daily item from before today.
export const isStaleDaily = (d: Daily, today: string = todayString()): boolean =>
  !d.completed && !!d.date && d.date < today;

export const setDailyCompleted = (spaceId: string, dailyId: string, completed: boolean) =>
  updateDoc(dailyRef(spaceId, dailyId), { completed });

export const deleteDaily = (spaceId: string, dailyId: string) =>
  deleteDoc(dailyRef(spaceId, dailyId));

// Helper function to generate a SHA-256 hash string from an email
export const generateIdFromEmail = async (email: string): Promise<string> => {
  const lowerCaseEmail = email.toLowerCase(); // Normalize to lowercase first
  const encoder = new TextEncoder();
  const data = encoder.encode(lowerCaseEmail);
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    // Convert ArrayBuffer to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  } catch (error) {
    console.error("Error generating SHA-256 hash:", error);
    // Fallback or re-throw, depending on how critical this is. 
    // For now, re-throwing as it's crucial for ID generation.
    throw new Error('Could not generate a unique ID for the email.');
  }
};

// --- Public Profile Functions ---
// users/{uid} is owner-readable only (PII like email lives there).
// publicProfiles/{uid} is the cross-user source: displayName, photoURL and a
// SHA-256 emailHash for exact-match lookup — never the email itself.

export interface PublicProfile {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
}

export const upsertPublicProfile = async (user: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}) => {
  const profileRef = doc(db, 'publicProfiles', user.uid);
  await setDoc(profileRef, {
    displayName: user.displayName ?? null,
    displayNameLower: user.displayName ? user.displayName.toLowerCase() : null,
    photoURL: user.photoURL ?? null,
    emailHash: user.email ? await generateIdFromEmail(user.email) : null,
  }, { merge: true });
};

export const getPublicProfile = async (userId: string): Promise<PublicProfile | null> => {
  const docSnap = await getDoc(doc(db, 'publicProfiles', userId));
  if (!docSnap.exists()) return null;
  const data = docSnap.data();
  return {
    uid: docSnap.id,
    displayName: data.displayName ?? null,
    photoURL: data.photoURL ?? null,
  };
};

// Exact-match lookup by email hash: callers must already know the address,
// so the user base cannot be enumerated via prefix scans.
export const findUserByEmail = async (email: string): Promise<PublicProfile | null> => {
  const emailHash = await generateIdFromEmail(email.trim());
  const q = query(collection(db, 'publicProfiles'), where('emailHash', '==', emailHash), limit(1));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const docSnap = snapshot.docs[0];
  const data = docSnap.data();
  return {
    uid: docSnap.id,
    displayName: data.displayName ?? null,
    photoURL: data.photoURL ?? null,
  };
};

export const searchUsersByDisplayName = async (prefix: string, max = 5): Promise<PublicProfile[]> => {
  const prefixLower = prefix.toLowerCase();
  const q = query(
    collection(db, 'publicProfiles'),
    where('displayNameLower', '>=', prefixLower),
    where('displayNameLower', '<=', prefixLower + '\uf8ff'),
    limit(max)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      uid: docSnap.id,
      displayName: data.displayName ?? null,
      photoURL: data.photoURL ?? null,
    };
  });
};

// --- Contact Management Functions --- 

export const sendContactRequest = async (targetEmailInput: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("User not authenticated.");

  const targetEmail = targetEmailInput.trim().toLowerCase();
  if (currentUser.email?.toLowerCase() === targetEmail) throw new Error("You cannot send a contact request to yourself.");

  const targetProfile = await findUserByEmail(targetEmail);

  const currentUid = currentUser.uid;

  if (!targetProfile) {
    // --- User does not exist: Initiate an Invite --- 
    console.log(`User with email ${targetEmail} not found. Initiating an invite.`);
    
    const hashedEmailId = await generateIdFromEmail(targetEmail);
    const outgoingInviteRef = doc(db, 'users', currentUid, 'outgoingContactRequests', hashedEmailId);

    const existingInviteSnap = await getDoc(outgoingInviteRef);
    if (existingInviteSnap.exists()) {
      // Check if it's a resent invite or truly pending
      const existingData = existingInviteSnap.data();
      if (existingData?.status === 'invited') {
        throw new Error(`An invitation for ${targetEmail} has already been sent and is pending.`);
      } else {
        // If status is something else (e.g. old, resolved), allow re-inviting by overwriting
        console.log(`Found previous non-pending invite for ${targetEmail}, proceeding to re-invite.`);
      }
    }

    await setDoc(outgoingInviteRef, {
      targetEmail: targetEmail, // Store the original (lowercase) email
      status: 'invited',
      requestedAt: serverTimestamp(),
      // No targetUid or targetUser details as the user doesn't exist yet
    });
    return { status: 'invited', message: `User ${targetEmail} not found. An invitation has been initiated.` };

  } else {
    // --- User exists: Proceed with normal contact request ---
    const targetUid = targetProfile.uid;
    const targetUserData = targetProfile;

    const contactRef = doc(db, 'users', currentUid, 'contacts', targetUid);
    const outgoingRequestRef = doc(db, 'users', currentUid, 'outgoingContactRequests', targetUid);
    const targetIncomingRequestRef = doc(db, 'users', targetUid, 'incomingContactRequests', currentUid);
    const requestFromTargetToCurrentUserRef = doc(db, 'users', currentUid, 'incomingContactRequests', targetUid);
    
    const contactSnap = await getDoc(contactRef);
    if (contactSnap.exists()) throw new Error(`You are already contacts with ${targetUserData.displayName || targetEmail}.`);

    const outgoingRequestSnap = await getDoc(outgoingRequestRef);
    if (outgoingRequestSnap.exists()) throw new Error(`Contact request to ${targetUserData.displayName || targetEmail} already sent.`);

    const requestFromTargetToCurrentUserSnap = await getDoc(requestFromTargetToCurrentUserRef);
    if (requestFromTargetToCurrentUserSnap.exists()) {
      const batch = writeBatch(db);
      batch.set(contactRef, {
        uid: targetUid,
        email: targetEmail,
        displayName: targetUserData.displayName || null,
        photoURL: targetUserData.photoURL || null,
        addedAt: serverTimestamp(),
      });
      const targetContactRef = doc(db, 'users', targetUid, 'contacts', currentUid);
      batch.set(targetContactRef, {
        uid: currentUid,
        email: currentUser.email,
        displayName: currentUser.displayName,
        photoURL: currentUser.photoURL,
        addedAt: serverTimestamp(),
      });
      batch.delete(requestFromTargetToCurrentUserRef); 
      const correspondingOutgoingRequestFromTargetRef = doc(db, 'users', targetUid, 'outgoingContactRequests', currentUid);
      batch.delete(correspondingOutgoingRequestFromTargetRef);
      await batch.commit();
      return { status: 'contact_added', message: `Successfully added ${targetUserData.displayName || targetEmail} as a contact (accepted their prior request).` };
    }

    const batch = writeBatch(db);
    const requestData = { requestedAt: serverTimestamp(), status: 'pending' };
    const incomingData = {
      ...requestData,
      requesterEmail: currentUser.email,
      requesterDisplayName: currentUser.displayName,
      requesterPhotoURL: currentUser.photoURL,
    };
    // targetEmail lives in the sender's own subcollection so the outgoing
    // list can show it without reading the target's (now private) user doc.
    batch.set(outgoingRequestRef, { ...requestData, targetEmail });
    batch.set(targetIncomingRequestRef, incomingData);
    await batch.commit();
    return { status: 'request_sent', message: `Contact request successfully sent to ${targetUserData.displayName || targetEmail}.` };
  }
};

// --- Interface for Outgoing Request Data (Updated for Invites) --- 
export interface OutgoingRequest {
  id: string; // Can be targetUserId OR hashedEmailId for invites
  status: 'pending' | 'invited' | 'accepted' | 'rejected'; // Added 'invited'
  requestedAt: Date;
  targetUser?: { 
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
  } | null; 
  targetEmail?: string; // Email of the invited user, present if status is 'invited'
}

// --- Function to get outgoing contact requests (Updated for Invites) --- 
export const getOutgoingContactRequests = async (userId: string): Promise<OutgoingRequest[]> => {
  if (!userId) return [];
  try {
    const requestsColRef = collection(db, 'users', userId, 'outgoingContactRequests');
    const q = query(requestsColRef, orderBy('requestedAt', 'desc')); 
    const snapshot = await getDocs(q);
    if (snapshot.empty) return [];

    const requestsPromises = snapshot.docs.map(async (reqDoc) => {
      const reqData = reqDoc.data();
      const docId = reqDoc.id; // This is either a UID or a hashedEmailId

      let targetUserProfile: OutgoingRequest['targetUser'] = null;
      let resolvedTargetEmail: string | undefined = reqData.targetEmail; // Get from doc if present for invites

      if (reqData.status !== 'invited') {
        // For non-invite statuses, docId should be a targetUserId
        try {
          const userProfile = await getPublicProfile(docId); // docId is targetUserId here
          if (userProfile) {
            targetUserProfile = {
              displayName: userProfile.displayName,
              email: resolvedTargetEmail ?? null,
              photoURL: userProfile.photoURL,
            };
          }
        } catch (profileError) {
          console.error(`Error fetching profile for target user ${docId}:`, profileError);
        }
      } else if (!resolvedTargetEmail) {
        // This case is problematic for an 'invited' status if targetEmail is missing.
        // It implies data inconsistency if an invite was created without storing targetEmail.
        console.warn(`Outgoing request with ID ${docId} has status 'invited' but no targetEmail field was found in the document. This invite may not be actionable.`);
      }
      
      return {
        id: docId, 
        status: reqData.status || 'pending', 
        requestedAt: reqData.requestedAt?.toDate ? reqData.requestedAt.toDate() : new Date(), 
        targetUser: targetUserProfile,
        targetEmail: resolvedTargetEmail, // This will be undefined if not available
      } as OutgoingRequest;
    });
    return Promise.all(requestsPromises);
  } catch (error) {
    console.error("Error fetching outgoing contact requests:", error);
    throw error;
  }
};

// --- Interface for Incoming Request Data --- 
export interface IncomingRequest {
  id: string; // requesterId
  status: string;
  requestedAt: Date;
  requesterDisplayName?: string | null;
  requesterEmail?: string | null;
  requesterPhotoURL?: string | null;
}

// --- Function to get incoming contact requests --- 
export const getIncomingContactRequests = async (userId: string): Promise<IncomingRequest[]> => {
  if (!userId) return [];
  try {
    const requestsColRef = collection(db, 'users', userId, 'incomingContactRequests');
    const q = query(requestsColRef, orderBy('requestedAt', 'desc'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return [];

    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id, // requesterId
        status: data.status || 'pending',
        requestedAt: data.requestedAt?.toDate ? data.requestedAt.toDate() : new Date(),
        requesterDisplayName: data.requesterDisplayName || null,
        requesterEmail: data.requesterEmail || null,
        requesterPhotoURL: data.requesterPhotoURL || null,
      } as IncomingRequest;
    });
  } catch (error) {
    console.error("Error fetching incoming contact requests:", error);
    throw error;
  }
};

// --- Function to accept a contact request ---
export const acceptContactRequest = async (
  currentUserId: string, 
  requesterId: string, 
  // Pass requester's data to store in current user's contact list
  requesterData: { email?: string | null; displayName?: string | null; photoURL?: string | null } = {}
) => {
  if (!currentUserId || !requesterId) throw new Error("Missing user IDs.");

  const currentUser = auth.currentUser; // For current user's details
  if (!currentUser || currentUser.uid !== currentUserId) {
    throw new Error("User mismatch or not authenticated for accepting request.");
  }

  const batch = writeBatch(db);

  // 1. Add requester to current user's contacts
  const currentUserContactRef = doc(db, 'users', currentUserId, 'contacts', requesterId);
  batch.set(currentUserContactRef, {
    uid: requesterId,
    email: requesterData.email || null,
    displayName: requesterData.displayName || null,
    photoURL: requesterData.photoURL || null,
    addedAt: serverTimestamp(),
  });

  // 2. Add current user to requester's contacts
  // (Fetch current user's profile data for this)
  let currentUserProfileData = { 
      email: currentUser.email, 
      displayName: currentUser.displayName, 
      photoURL: currentUser.photoURL 
  };
  // Optionally, re-fetch profile to ensure it's up-to-date, or rely on auth object
  // const profile = await getUserProfile(currentUserId);
  // if (profile) currentUserProfileData = { email: profile.email, displayName: profile.displayName, photoURL: profile.photoURL };

  const requesterContactRef = doc(db, 'users', requesterId, 'contacts', currentUserId);
  batch.set(requesterContactRef, {
    uid: currentUserId,
    email: currentUserProfileData.email,
    displayName: currentUserProfileData.displayName,
    photoURL: currentUserProfileData.photoURL,
    addedAt: serverTimestamp(),
  });

  // 3. Delete incoming request for current user
  const incomingRequestRef = doc(db, 'users', currentUserId, 'incomingContactRequests', requesterId);
  batch.delete(incomingRequestRef);

  // 4. Delete outgoing request for the requester
  const outgoingRequestRef = doc(db, 'users', requesterId, 'outgoingContactRequests', currentUserId);
  batch.delete(outgoingRequestRef);

  await batch.commit();
  console.log(`Contact request from ${requesterId} accepted by ${currentUserId}.`);
};

// --- Function to reject a contact request ---
export const rejectContactRequest = async (currentUserId: string, requesterId: string) => {
  if (!currentUserId || !requesterId) throw new Error("Missing user IDs for rejection.");

  const batch = writeBatch(db);

  // 1. Delete incoming request for current user
  const incomingRequestRef = doc(db, 'users', currentUserId, 'incomingContactRequests', requesterId);
  batch.delete(incomingRequestRef);

  // 2. Optional: Update status of or delete outgoing request for the requester
  // For simplicity, we can just delete it. Or update its status to 'rejected'.
  const outgoingRequestRef = doc(db, 'users', requesterId, 'outgoingContactRequests', currentUserId);
  // Option A: Delete it
  batch.delete(outgoingRequestRef);
  // Option B: Update status (if you want the sender to see it was rejected)
  // batch.update(outgoingRequestRef, { status: 'rejected', updatedAt: serverTimestamp() });

  await batch.commit();
  console.log(`Contact request from ${requesterId} rejected by ${currentUserId}.`);
};

// --- Interface for Contact Data --- 
export interface Contact {
  uid: string; // UID of the contact
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  addedAt: Date; // When the contact was added
}

// --- Function to get user's contacts --- 
export const getContacts = async (userId: string): Promise<Contact[]> => {
  if (!userId) return [];
  try {
    const contactsColRef = collection(db, 'users', userId, 'contacts');
    // Order by displayName for a sorted list, or by addedAt
    const q = query(contactsColRef, orderBy('displayName', 'asc')); 
    // const q = query(contactsColRef, orderBy('addedAt', 'desc')); 
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return [];
    }

    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        uid: doc.id, // The document ID is the contact's UID
        email: data.email || null,
        displayName: data.displayName || null,
        photoURL: data.photoURL || null,
        addedAt: data.addedAt?.toDate ? data.addedAt.toDate() : new Date(),
      } as Contact;
    });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    throw error;
  }
};

// --- Function to cancel an outgoing contact request or invite --- 
export const cancelOutgoingRequest = async (
  currentUserId: string,
  targetIdentifier: string, // This is targetUserId for normal requests, or hashedEmailId for invites
  isInvite: boolean
): Promise<{ message: string }> => {
  if (!currentUserId || !targetIdentifier) {
    throw new Error("Current user ID and target identifier are required.");
  }

  const batch = writeBatch(db);

  // 1. Delete the outgoing request/invite from the current user's subcollection
  const outgoingRequestRef = doc(db, 'users', currentUserId, 'outgoingContactRequests', targetIdentifier);
  batch.delete(outgoingRequestRef);

  // 2. If it was a normal request (not an invite), also delete the corresponding incoming request from the target user's subcollection
  if (!isInvite) {
    const targetUserId = targetIdentifier; // For non-invites, targetIdentifier is the UID of the target
    const incomingRequestAtTargetRef = doc(db, 'users', targetUserId, 'incomingContactRequests', currentUserId);
    batch.delete(incomingRequestAtTargetRef);
    console.log(`Also deleting incoming request at users/${targetUserId}/incomingContactRequests/${currentUserId}`);
  }

  try {
    await batch.commit();
    if (isInvite) {
      return { message: "Invitation successfully canceled." };
    } else {
      return { message: "Contact request successfully canceled." };
    }
  } catch (error) {
    console.error("Error canceling outgoing request/invite:", error);
    throw new Error("Failed to cancel the request/invite. Please try again.");
  }
};

// --- Add other potential functions like getIncomingContactRequests, getContacts etc. later ---
