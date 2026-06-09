'use client';

import { useState, useEffect } from 'react';
import { collectionGroup, query, where, onSnapshot, orderBy, Timestamp, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useError } from '@/lib/hooks/useError';
import Link from 'next/link';
import Image from 'next/image';

// Simple interface for Mentioned Todo Item
interface MentionedTodo {
  id: string;
  text: string; // Display text for now
  ownerId: string;
  createdAt: Date;
  path: string; // Full path to the document
}

// Interface for owner info cache
interface OwnerInfo {
  displayName?: string | null;
  photoURL?: string | null;
}

export default function MentionsList() {
  const { user, loading: authLoading } = useAuth();
  const { reportError } = useError();
  const [mentionedTodos, setMentionedTodos] = useState<MentionedTodo[]>([]);
  // State to cache owner information { [ownerId]: { displayName, photoURL } }
  const [ownersInfo, setOwnersInfo] = useState<Record<string, OwnerInfo>>({});
  const [loading, setLoading] = useState(true);
  const [loadingOwners, setLoadingOwners] = useState(false); // Separate loading for owners

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    console.log(`Setting up mentions listener for user ${user.uid}`);

    const q = query(
      collectionGroup(db, 'todos'),
      where('mentionedUsers', 'array-contains', user.uid),
      orderBy('createdAt', 'desc') // Order by creation date
    );

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        console.log("Mentions snapshot received:", snapshot.docs.length, "docs");
        const todosData = snapshot.docs.map(doc => {
          const data = doc.data();
          const ownerId = doc.ref.parent.parent?.id; // Get owner from path
          if (!ownerId) return null; // Should have owner

          // TODO: Fetch owner's displayName efficiently later
          
          return {
            id: doc.id,
            text: data.text || '[No Text Content]', // Use plain text for now
            ownerId: ownerId,
            createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate() : new Date(),
            path: doc.ref.path, // Store the full path
          };
        }).filter((todo): todo is MentionedTodo => todo !== null);
        
        console.log("Processed mentioned todos:", todosData);
        setMentionedTodos(todosData);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching mentioned todos snapshot:", error);
        reportError(error, { component: 'MentionsList', operation: 'fetchMentionsSnapshot' });
        setLoading(false);
      }
    );

    return () => {
      console.log("Cleaning up mentions listener");
      unsubscribe();
    };

  }, [user, reportError]);

  // Effect to fetch owner info when mentionedTodos changes
  useEffect(() => {
    if (!mentionedTodos || mentionedTodos.length === 0) return;

    const fetchOwnerInfo = async () => {
      setLoadingOwners(true);
      const ownerIdsToFetch = mentionedTodos
        .map(todo => todo.ownerId)
        .filter((id, index, self) => self.indexOf(id) === index) // Get unique IDs
        .filter(id => !ownersInfo[id]); // Filter out already fetched IDs

      if (ownerIdsToFetch.length === 0) {
        setLoadingOwners(false);
        return; // Nothing new to fetch
      }

      console.log("Fetching owner info for IDs:", ownerIdsToFetch);
      const newOwnersInfo: Record<string, OwnerInfo> = {};
      const promises = ownerIdsToFetch.map(async (ownerId) => {
        try {
          const userDocRef = doc(db, 'publicProfiles', ownerId);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const data = userDoc.data();
            newOwnersInfo[ownerId] = {
              displayName: data.displayName || null,
              photoURL: data.photoURL || null,
            };
          } else {
            newOwnersInfo[ownerId] = { displayName: 'Unknown User' }; // Fallback
          }
        } catch (error) {
          console.error(`Error fetching owner info for ${ownerId}:`, error);
          newOwnersInfo[ownerId] = { displayName: 'Error Loading User' }; // Error state
          // Optionally report this specific error
          if (error instanceof Error) {
             reportError(error, { component: 'MentionsList', operation: 'fetchOwnerInfo', ownerId });
          }
        }
      });

      await Promise.all(promises);
      console.log("Fetched owner info:", newOwnersInfo);
      setOwnersInfo(prev => ({ ...prev, ...newOwnersInfo }));
      setLoadingOwners(false);
    };

    fetchOwnerInfo();
  // Dependencies: mentionedTodos array and the ownersInfo cache itself
  }, [mentionedTodos, ownersInfo, reportError]); 

  if (loading || authLoading) {
    return (
      <div className="text-center p-4 text-gray-500 dark:text-gray-400">
        Loading mentions...
      </div>
    );
  }

  if (!user) {
     // Should normally not be reached due to ProtectedLayout
    return <p>Please log in.</p>; 
  }

  if (mentionedTodos.length === 0) {
    return (
      <p className="text-center text-gray-500 dark:text-gray-400">
        You haven&apos;t been mentioned in any todos yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {mentionedTodos.map((todo) => {
        // Look up owner info from state
        const owner = ownersInfo[todo.ownerId]; 
        const ownerName = owner?.displayName || todo.ownerId; // Use ID as fallback
        const ownerPhoto = owner?.photoURL;

        return (
          <div key={todo.path} className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex gap-4 items-start">
            {/* Owner Avatar */}
            <div className="relative w-8 h-8 rounded-full overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0 mt-1">
               {ownerPhoto ? (
                   <Image src={ownerPhoto} alt={ownerName} fill className="object-cover" sizes="32px" />
               ) : (
                   <div className="w-full h-full bg-gray-200 dark:bg-gray-500 flex items-center justify-center">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-200">
                         {ownerName?.[0]?.toUpperCase() || '?'}
                      </span>
                   </div>
               )}
            </div>

            {/* Todo Content and Meta */}
            <div className="flex-1">
                <p className="text-gray-800 dark:text-gray-100 mb-1">
                    {todo.text} 
                </p>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                    <span>Mentioned by: {ownerName}</span> 
                    <span className="mx-2">|</span>
                    <span>{todo.createdAt.toLocaleString()}</span>
                </div>
            </div>
          </div>
        );
      })}
    </div>
  );
} 