"use client";

import { useState } from 'react';
import { doc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/firebase';
import UserSearch from './UserSearch';
import Image from 'next/image';
import { useAuth } from '@/lib/hooks/useAuth';
import { useError } from '@/lib/hooks/useError';

interface ShareTodoProps {
  todoId: string;
  userId: string;
}

export default function ShareTodo({ todoId, userId }: ShareTodoProps) {
  const { user } = useAuth();
  const { reportError } = useError();
  const [localError, setLocalError] = useState<string | null>(null);
  const [users, setUsers] = useState<{ uid: string; email: string | null; displayName: string | null; photoURL: string | null }[]>([]);

  const handleShare = async (userToShare: { uid: string; email: string | null; displayName: string | null; photoURL: string | null }) => {
    if (!user) {
      setLocalError('You must be logged in to share todos');
      return;
    }

    try {
      setLocalError(null);
      const todoRef = doc(db, `users/${userId}/todos/${todoId}`);
      const todoDoc = await getDoc(todoRef);
      
      if (!todoDoc.exists()) {
        setLocalError('Todo not found');
        return;
      }

      const todoData = todoDoc.data();
      if (userId !== user.uid) {
        setLocalError('You can only share your own todos');
        reportError(new Error('Attempted to share todo not owned by user'), {
            component: 'ShareTodo',
            operation: 'handleShareValidation',
            ownerId: userId,
            actingUserId: user.uid,
            todoId: todoId,
        });
        return;
      }

      if (todoData.sharedWith && todoData.sharedWith.includes(userToShare.uid)) {
        setLocalError('Todo is already shared with this user');
        return;
      }

      await updateDoc(todoRef, {
        sharedWith: arrayUnion(userToShare.uid)
      });

      const userRef = doc(db, 'publicProfiles', userToShare.uid);
      const userDoc = await getDoc(userRef);
      const userData = userDoc.exists() ? userDoc.data() : userToShare;

      setUsers(prev => [...prev, {
        uid: userToShare.uid,
        email: userData.email || userToShare.email,
        displayName: userData.displayName || userToShare.displayName,
        photoURL: userData.photoURL || userToShare.photoURL
      }]);
      
    } catch (err) {
      console.error('Error sharing todo:', err);
      setLocalError('Failed to share todo. Please try again.');
      if (err instanceof Error) {
        reportError(err, { component: 'ShareTodo', operation: 'handleShareUpdate', todoId: todoId, ownerId: userId, sharedWithUid: userToShare.uid });
      } else {
        reportError(new Error('Unknown error sharing todo'), { component: 'ShareTodo', operation: 'handleShareUpdate', todoId: todoId, ownerId: userId, sharedWithUid: userToShare.uid });
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <UserSearch onSelect={handleShare} excludeUsers={users.map(u => u.uid).concat([userId])} />
      </div>
      
      {localError && (
        <div className="text-red-500 text-sm">{localError}</div>
      )}

      {users.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Shared with:</h3>
          <div className="space-y-2">
            {users.map((user) => (
              <div key={user.uid} className="flex items-center space-x-2">
                {user.photoURL ? (
                  <Image
                    src={user.photoURL}
                    alt={user.displayName || 'User avatar'}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                ) : (
                  <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center">
                    <span className="text-xs text-gray-500">
                      {user.displayName?.[0] || user.email?.[0] || '?'}
                    </span>
                  </div>
                )}
                <span className="text-sm text-gray-900">
                  {user.displayName || user.email || user.uid}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
} 