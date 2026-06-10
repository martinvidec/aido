import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Editor } from '@tiptap/react';
import { normalizeLinkUrl } from '@/lib/tiptap/linkSecurity';
import {
  FaBold,
  FaItalic,
  FaUnderline,
  FaStrikethrough,
  FaHeading,
  FaListUl,
  FaListOl,
  FaQuoteLeft,
  FaCode,
  FaLink,
  FaUnlink,
  FaHighlighter,
  FaTasks,
  FaUndo,
  FaRedo,
  FaSmile,
} from 'react-icons/fa';
import EmojiPicker, { EmojiClickData, Theme as EmojiTheme } from 'emoji-picker-react';
import { useTheme } from '@/lib/contexts/ThemeContext';

interface TiptapToolbarProps {
  editor: Editor | null;
}

const TiptapToolbar: React.FC<TiptapToolbarProps> = ({ editor }) => {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node) &&
        emojiButtonRef.current &&
        !emojiButtonRef.current.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const onEmojiClick = useCallback((emojiData: EmojiClickData) => {
    if (!editor) return;
    editor.chain().focus().insertContent(emojiData.emoji).run();
    setShowEmojiPicker(false);
  }, [editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    const safeUrl = normalizeLinkUrl(url);
    if (!safeUrl) {
      window.alert('Only http(s) and mailto links are allowed.');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: safeUrl }).run();
  }, [editor]);

  if (!editor) {
    return null;
  }

  const getButtonClass = (type: string, attributes?: Record<string, any>) => {
    const baseClass = 'p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600';
    const activeClass = editor.isActive(type, attributes)
      ? 'bg-gray-300 dark:bg-gray-500'
      : '';
    return `${baseClass} ${activeClass}`;
  };

  return (
    <div className="relative flex flex-wrap items-center gap-1 p-2 mb-1 border border-gray-300 dark:border-gray-600 rounded-t-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().toggleBold()}
        className={getButtonClass('bold') + ' p-1'}
        title="Bold (Ctrl+B)"
      >
        <FaBold />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().toggleItalic()}
        className={getButtonClass('italic') + ' p-1'}
        title="Italic (Ctrl+I)"
      >
        <FaItalic />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        disabled={!editor.can().toggleUnderline()}
        className={getButtonClass('underline') + ' p-1'}
        title="Underline (Ctrl+U)"
      >
        <FaUnderline />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={!editor.can().toggleStrike()}
        className={getButtonClass('strike') + ' p-1'}
        title="Strikethrough"
      >
        <FaStrikethrough />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        disabled={!editor.can().toggleHighlight()}
        className={getButtonClass('highlight') + ' p-1'}
        title="Highlight"
      >
        <FaHighlighter />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        disabled={!editor.can().toggleHeading({ level: 2 })}
        className={getButtonClass('heading', { level: 2 }) + ' p-1 inline-flex items-center justify-center w-6 h-6'}
        title="Heading 2"
      >
        <FaHeading />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        disabled={!editor.can().toggleHeading({ level: 3 })}
        className={getButtonClass('heading', { level: 3 }) + ' p-1 inline-flex items-center justify-center w-6 h-6'}
        title="Heading 3"
      >
        <FaHeading className="text-xs"/>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        disabled={!editor.can().toggleBulletList()}
        className={getButtonClass('bulletList') + ' p-1'}
        title="Bullet List"
      >
        <FaListUl />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        disabled={!editor.can().toggleOrderedList()}
        className={getButtonClass('orderedList') + ' p-1'}
        title="Ordered List"
      >
        <FaListOl />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        disabled={!editor.can().toggleTaskList()}
        className={getButtonClass('taskList') + ' p-1'}
        title="Task List"
      >
        <FaTasks />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        disabled={!editor.can().toggleBlockquote()}
        className={getButtonClass('blockquote') + ' p-1'}
        title="Blockquote"
      >
        <FaQuoteLeft />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        disabled={!editor.can().toggleCodeBlock()}
        className={getButtonClass('codeBlock') + ' p-1'}
        title="Code Block"
      >
        <FaCode />
      </button>
      <button
        type="button"
        onClick={setLink}
        disabled={!editor.can().setLink({ href: '' })}
        className={getButtonClass('link') + ' p-1'}
        title="Set Link"
      >
        <FaLink />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().unsetLink().run()}
        disabled={!editor.isActive('link')}
        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Unset Link"
      >
        <FaUnlink />
      </button>
      <button
        ref={emojiButtonRef}
        type="button"
        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${showEmojiPicker ? 'bg-gray-300 dark:bg-gray-500' : ''}`}
        title="Add Emoji"
      >
        <FaSmile />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Ctrl+Z)"
        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
      >
        <FaUndo />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Ctrl+Y)"
        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
      >
        <FaRedo />
      </button>
      {showEmojiPicker && (
        <div
          ref={emojiPickerRef}
          className="absolute z-20 top-full left-0 mt-1"
        >
          <EmojiPicker
            onEmojiClick={onEmojiClick}
            autoFocusSearch={false}
            height={350}
            width={300}
            theme={resolvedTheme === 'dark' ? EmojiTheme.DARK : EmojiTheme.LIGHT}
            lazyLoadEmojis={true}
            searchPlaceholder="Search emojis..."
          />
        </div>
      )}
    </div>
  );
};

export default TiptapToolbar; 