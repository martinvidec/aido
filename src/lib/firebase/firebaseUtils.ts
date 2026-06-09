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
} from "firebase/firestore";
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

// Helper function to generate a SHA-256 hash string from an email
const generateIdFromEmail = async (email: string): Promise<string> => {
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

// --- User Profile Functions --- 

export const saveUserProfile = async (userId: string, data: { email?: string | null; displayName?: string | null; photoURL?: string | null }) => {
  const userRef = doc(db, 'users', userId);
  const profileData = {
    ...data,
    displayNameLower: data.displayName ? data.displayName.toLowerCase() : null,
  };
  await setDoc(userRef, profileData, { merge: true });
};

export const getUserProfile = async (userId: string) => {
  const userRef = doc(db, 'users', userId);
  const docSnap = await getDoc(userRef);
  return docSnap.exists() ? docSnap.data() : null;
};

// --- Contact Management Functions --- 

export const sendContactRequest = async (targetEmailInput: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("User not authenticated.");

  const targetEmail = targetEmailInput.trim().toLowerCase();
  if (currentUser.email?.toLowerCase() === targetEmail) throw new Error("You cannot send a contact request to yourself.");

  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('email', '==', targetEmail), limit(1));
  const querySnapshot = await getDocs(q);

  const currentUid = currentUser.uid;

  if (querySnapshot.empty) {
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
    const targetUserDoc = querySnapshot.docs[0];
    const targetUid = targetUserDoc.id;
    const targetUserData = targetUserDoc.data();

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
        email: targetUserData.email || targetEmail,
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
    batch.set(outgoingRequestRef, requestData);
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
          const userProfile = await getUserProfile(docId); // docId is targetUserId here
          if (userProfile) {
            targetUserProfile = {
              displayName: userProfile.displayName,
              email: userProfile.email,
              photoURL: userProfile.photoURL,
            };
            // If targetEmail wasn't in the doc (e.g. older pending requests before this change),
            // try to populate it from the fetched profile.
            if (!resolvedTargetEmail) resolvedTargetEmail = userProfile.email;
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
