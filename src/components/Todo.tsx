import { useState, useEffect, useRef } from 'react';
import { doc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/firebase';
import ShareTodo from './ShareTodo';
import { useAuth } from '@/lib/hooks/useAuth';
import { useError } from '@/lib/hooks/useError';
import Image from 'next/image';

// Tiptap imports - REMOVE specific extension imports here
import { useEditor, EditorContent } from '@tiptap/react';
// import StarterKit from '@tiptap/starter-kit';
// ... remove others ...

import TiptapToolbar from './TiptapToolbar';
// Import the configuration hook
import { useTiptapConfig } from '@/lib/hooks/useTiptapConfig';
import { extractHashtags } from '@/lib/utils/textUtils';
import { extractMentionIds } from '@/lib/utils/textUtils';

// --- Helper function to extract mention UIDs --- 
// const extractMentionIds = (node: any): string[] => {
//   let ids: string[] = [];
//   if (node.type === 'mention' && node.attrs?.id) {
//     ids.push(node.attrs.id);
//   }
//   if (node.content) {
//     node.content.forEach((childNode: any) => {
//       ids = ids.concat(extractMentionIds(childNode));
//     });
//   }
//   return [...new Set(ids)]; 
// };
// --- End Helper --- 

interface UserInfo {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  // publicProfiles carry no email; kept optional as a display fallback only
  email?: string | null;
}

interface TodoProps {
  id: string;
  content: any | null;
  text?: string;
  completed: boolean;
  userId: string;
  sharedWith?: string[];
  isOwner: boolean;
  originalUserId?: string;
  mentionedUsers?: string[];
  tags?: string[];
}

export default function Todo({ id, content, text, completed, userId, sharedWith = [], isOwner: isOwnerProp, originalUserId, tags }: TodoProps) {
  const [isEditing, setIsEditing] = useState(false);
  const prevIsEditingRef = useRef(isEditing);
  const [showShare, setShowShare] = useState(false);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const { user } = useAuth();
  const { reportError } = useError();
  const [isInCodeBlock, setIsInCodeBlock] = useState(false);

  const isOwner = user?.uid === userId;
  const canEdit = isOwner;
  const canToggleComplete = isOwner || (sharedWith ?? []).includes(user?.uid || '');

  // --- Get Editor Configurations --- 
  const { extensions: displayExtensions, editorProps: displayEditorProps } = useTiptapConfig({
    editable: false,
    enableMentionSuggestion: false,
  });

  const { extensions: editExtensions, editorProps: editEditorProps } = useTiptapConfig({
    editable: true,
    enableMentionSuggestion: true,
    // placeholder: 'Edit your todo...' // Add placeholder if desired
  });

  // DISPLAY Editor - using config from hook
  const displayEditor = useEditor({
    editable: false,
    content: content || text || '',
    extensions: displayExtensions,
    editorProps: displayEditorProps,
    immediatelyRender: false,
  }, []);

  // EDIT Editor - using config from hook
  const editEditor = useEditor({
    editable: true,
    content: '', // Set dynamically via useEffect
    extensions: editExtensions,
    editorProps: editEditorProps, // Use props from hook
    immediatelyRender: false,
    // Add event listener for selection updates
    onSelectionUpdate: ({ editor }) => {
      setIsInCodeBlock(editor.isActive('codeBlock'));
    },
    // Also check on initial creation or content updates (when editing starts)
    onCreate: ({ editor }) => {
      setIsInCodeBlock(editor.isActive('codeBlock'));
    },
    // Add onFocus to reset state when editor gains focus
    onFocus: ({ editor }) => {
      setIsInCodeBlock(editor.isActive('codeBlock'));
    },
  }, []);

  // --- Effects --- 
  // Effect to update DISPLAY editor when props change
  useEffect(() => {
    if (displayEditor && !displayEditor.isDestroyed && !isEditing) {
      const currentContentJSON = JSON.stringify(displayEditor.getJSON());
      const propContentJSON = JSON.stringify(content || {});
      const currentContentText = displayEditor.getText();
      const propText = text || '';

      // Update only if content actually differs
      if (propContentJSON !== currentContentJSON || (Object.keys(content || {}).length === 0 && propText !== currentContentText)) {
         console.log("(Todo) Updating displayEditor content due to prop change.");
         displayEditor.commands.setContent(content || text || '', false); 
      }
    }
    // Keep dependencies: We want this effect to run when props change or editor initializes
  }, [content, text, displayEditor, isEditing]);

  // Effect to set content for EDIT editor (remains the same)
  useEffect(() => {
    if (isEditing && !prevIsEditingRef.current && editEditor && !editEditor.isDestroyed) {
      editEditor.commands.setContent(content || text || '', false);
      editEditor.commands.focus('end');
    }
    prevIsEditingRef.current = isEditing;
  }, [isEditing, editEditor, content, text]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const userPromises = [
          // Get owner info
          getDoc(doc(db, 'publicProfiles', userId)),
          // Get shared users info
          ...(sharedWith ?? []).map(uid => getDoc(doc(db, 'publicProfiles', uid)))
        ];

        const userDocs = await Promise.all(userPromises);
        const userInfos = userDocs
          .filter(doc => doc.exists())
          .map(doc => ({
            uid: doc.id,
            ...(doc.data() as Omit<UserInfo, 'uid'>),
          }));

        // Sort users: owner first, then shared users
        const owner = userInfos.find(u => u.uid === userId);
        const sharedUsers = userInfos.filter(u => u.uid !== userId);
        setUsers([owner, ...sharedUsers].filter(Boolean) as UserInfo[]);
      } catch (error) {
        console.error('Error fetching user info:', error);
        if (error instanceof Error) {
          reportError(error, { component: 'Todo', operation: 'fetchUsers', todoId: id, ownerId: userId });
        } else {
          reportError(new Error('Unknown error fetching user info'), { component: 'Todo', operation: 'fetchUsers', todoId: id, ownerId: userId });
        }
      }
    };

    fetchUsers();
  }, [userId, sharedWith, reportError, id]);

  const toggleComplete = async () => {
    if (!canToggleComplete) return;
    
    const todoRef = doc(db, `users/${userId}/todos/${id}`);
    try {
      await updateDoc(todoRef, {
        completed: !completed
      });
    } catch (error) {
      console.error('Error toggling complete:', error);
      if (error instanceof Error) {
        reportError(error, { component: 'Todo', operation: 'toggleComplete', todoId: id, ownerId: userId });
      } else {
        reportError(new Error('Unknown error toggling complete'), { component: 'Todo', operation: 'toggleComplete', todoId: id, ownerId: userId });
      }
    }
  };

  const handleSaveEdit = async () => {
    if (!canEdit || !editEditor) return;

    const newContentJSON = editEditor.getJSON();
    const newContentText = editEditor.getText();
    const newMentionedUserIds = extractMentionIds(newContentJSON);
    const newExtractedTags = extractHashtags(newContentText);

    if (newContentText.trim().length === 0) {
        reportError(new Error("Cannot save empty todo"), { component: 'Todo', operation: 'handleSaveEdit' });
        return;
    }

    try {
      const todoRef = doc(db, `users/${userId}/todos/${id}`);
      await updateDoc(todoRef, {
        content: newContentJSON,
        text: newContentText,
        mentionedUsers: newMentionedUserIds,
        tags: newExtractedTags,
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving todo edit:', error);
      if (error instanceof Error) {
        reportError(error, { component: 'Todo', operation: 'handleSaveEdit', todoId: id });
      } else {
        reportError(new Error('Unknown error saving todo edit'), { component: 'Todo', operation: 'handleSaveEdit', todoId: id });
      }
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!isOwner) return;
    
    const todoRef = doc(db, `users/${userId}/todos/${id}`);
    try {
      await deleteDoc(todoRef);
    } catch (error) {
      console.error('Error deleting todo:', error);
      if (error instanceof Error) {
        reportError(error, { component: 'Todo', operation: 'handleDelete', todoId: id, ownerId: userId });
      } else {
        reportError(new Error('Unknown error deleting todo'), { component: 'Todo', operation: 'handleDelete', todoId: id, ownerId: userId });
      }
    }
  };

  // Cleanup display editor
  useEffect(() => {
    return () => {
      displayEditor?.destroy();
      editEditor?.destroy();
    };
  }, [displayEditor, editEditor]);

  return (
    <div className="flex flex-col p-4 bg-white dark:bg-gray-800 rounded-lg shadow mb-2 border border-gray-200 dark:border-gray-700">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <input
            type="checkbox"
            checked={completed}
            onChange={toggleComplete}
            disabled={!canToggleComplete}
            className="form-checkbox flex-shrink-0 h-4 w-4 text-blue-600 transition duration-150 ease-in-out bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:checked:bg-blue-500 dark:focus:ring-offset-gray-800 mt-1"
          />
          <div className={`flex-1 ${completed && !isEditing ? 'line-through text-gray-500 dark:text-gray-400 opacity-70' : ''}`}>
             {isEditing ? (
                <>
                  <TiptapToolbar editor={editEditor} /> 
                  <div className="border border-t-0 border-gray-300 dark:border-gray-600 rounded-b-lg p-2 bg-white dark:bg-gray-700">
                    <EditorContent 
                      editor={editEditor} 
                    />
                  </div>
                  {isInCodeBlock && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Use Cmd/Ctrl+Enter to exit code block.
                    </p>
                  )}
                </>
             ) : (
                <EditorContent editor={displayEditor} />
             )}
          </div>
        </div>
        <div className="flex flex-col gap-1 self-start flex-shrink-0">
          {isEditing ? (
            <>
              <button
                onClick={handleSaveEdit}
                className="px-2 py-1 text-sm text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
              >
                Save
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-2 py-1 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {canEdit && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-2 py-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Edit
                </button>
              )}
              {isOwner && (
                <button
                  onClick={() => setShowShare(!showShare)}
                  className="px-2 py-1 text-sm text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300"
                >
                  {showShare ? 'Close' : 'Share'}
                </button>
              )}
              {isOwner && (
                <button
                  onClick={handleDelete}
                  className="px-2 py-1 text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {users.length > 0 && (
        <div className="mt-2 flex items-center gap-1">
          <span className="text-sm text-gray-500 dark:text-gray-400 mr-2">Access:</span>
          <div className="flex -space-x-2">
            {users.map((userInfo) => (
              <div
                key={userInfo.uid}
                className="relative w-6 h-6 rounded-full overflow-hidden border-2 border-white dark:border-gray-800"
                title={`${userInfo.displayName || userInfo.email || 'Unknown user'} ${userInfo.uid === userId ? '(Owner)' : ''}`.trim()}
              >
                {userInfo.photoURL ? (
                  <Image
                    src={userInfo.photoURL}
                    alt={userInfo.displayName || 'User avatar'}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                    <span className="text-xs text-gray-500 dark:text-gray-200">
                      {userInfo.displayName?.[0] || userInfo.email?.[0] || '?'}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showShare && isOwner && (
        <ShareTodo todoId={id} userId={userId} />
      )}
    </div>
  );
} 