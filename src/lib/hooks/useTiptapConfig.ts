import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Mention, { MentionOptions } from '@tiptap/extension-mention';
import Hashtag from '@/lib/tiptap/hashtagExtension';
import { EditorOptions } from '@tiptap/react';
// Re-import previously commented extensions
import ListItem from '@tiptap/extension-list-item';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import CodeBlock from '@tiptap/extension-code-block';
import Link from '@tiptap/extension-link';
import { ALLOWED_LINK_PROTOCOLS, isSafeLinkUrl } from '@/lib/tiptap/linkSecurity';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import { Editor } from '@tiptap/core'; // Keep Editor import for CustomCodeBlock

// Import the suggestion utility again
import { suggestionConfigUtility as baseSuggestionConfig } from '@/lib/tiptap/mentionSuggestion'; // Renamed for clarity
import { getContacts, Contact } from '@/lib/firebase/firebaseUtils'; // Import getContacts and Contact
import { SuggestionItem } from '@/components/SuggestionList'; // Assuming SuggestionItem is exported here

// Re-enable CustomCodeBlock definition
const CustomCodeBlock = CodeBlock.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      HTMLAttributes: { class: 'font-sans' },
    };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': ({ editor }: { editor: Editor }) => {
        const { $head, $anchor } = editor.state.selection;
        if ($head.parent.type.name === 'codeBlock' && 
            $head.parentOffset === $head.parent.content.size &&
            $head.pos === $anchor.pos) { 
          return editor.chain().focus().exitCode().run();
        }
        return false;
      },
      'Tab': ({ editor }: { editor: Editor }) => {
        if (editor.isActive('codeBlock')) {
            return editor.commands.insertContent('  ');
        }
        return false;
      },
      'Shift-Tab': () => {
        return true; 
      },
    };
  },
});

interface UseTiptapConfigOptions {
  editable: boolean;
  placeholder?: string;
  enableMentionSuggestion: boolean;
  currentUserId?: string; // Added currentUserId
  // When set, task-list checkboxes stay interactive even in a non-editable
  // editor (issue #45: toggling a checklist item in the rendered todo body).
  // Return true to allow the toggle (TipTap then mutates the doc and fires onUpdate).
  onReadOnlyChecked?: (node: unknown, checked: boolean) => boolean;
}

// This hook RETURNS configuration objects, it does NOT call useEditor itself.
export function useTiptapConfig({
  editable,
  placeholder,
  enableMentionSuggestion,
  currentUserId, // Destructure currentUserId
  onReadOnlyChecked,
}: UseTiptapConfigOptions): {
  extensions: EditorOptions['extensions'];
  editorProps: EditorOptions['editorProps'];
} {
  const mentionOptions: Partial<MentionOptions> = {
     HTMLAttributes: { class: 'mention' },
  };

  if (enableMentionSuggestion && currentUserId) { // Check for currentUserId
    mentionOptions.suggestion = {
      ...baseSuggestionConfig, // Spread the rest of the config (render, etc.)
      items: async ({ query: searchQuery }: { query: string }): Promise<SuggestionItem[]> => {
        if (!currentUserId) return []; // Should be caught by outer if, but good practice

        try {
          const contacts: Contact[] = await getContacts(currentUserId);
          
          const filteredContacts = contacts.filter(contact => {
            const searchLower = searchQuery.toLowerCase();
            const nameMatch = contact.displayName?.toLowerCase().includes(searchLower);
            const emailMatch = contact.email?.toLowerCase().includes(searchLower);
            return nameMatch || emailMatch;
          });

          return filteredContacts.map(contact => ({
            id: contact.uid,
            label: contact.displayName || contact.email || contact.uid, // Ensure label is always a string
            photoURL: contact.photoURL,
            // Ensure all fields expected by SuggestionItem are present or undefined
            // email: contact.email, // if SuggestionItem needs it
            // isRequest: false, // if SuggestionItem needs it
          }));
        } catch (error) {
          console.error("Error fetching contact suggestions for Tiptap:", error);
          return [];
        }
      },
    };
  } else if (enableMentionSuggestion) {
    // Fallback to original behavior if no currentUserId (e.g., for public pages or if user not logged in)
    // You might want to disable mentions entirely or use the original generic user search
    // For now, let's use the base config which searches all users (if it still exists and is desired)
    // Or, more safely, provide an empty items array or a specific "login to see contacts" message
     mentionOptions.suggestion = {
        ...baseSuggestionConfig, // Use the original config
        items: async () => { // Or provide a static "please log in" item
            // console.warn("Mention suggestion enabled but no currentUserId provided. Using base/generic suggestions.");
            // return (await baseSuggestionConfig.items({query: ''})); // if baseSuggestionConfig.items is still there
            return [{ id: 'login-prompt', label: 'Log in to see contacts', photoURL: undefined, isRequest: true, email: '' }]; // Example prompt
        }
     };
  }

  const extensions: EditorOptions['extensions'] = [
    StarterKit.configure({
      // Re-enable blockquote
      code: false, // Keep inline code disabled?
      codeBlock: false, // Use CustomCodeBlock instead
      dropcursor: false,
      gapcursor: false,
      hardBreak: false,
      // heading: undefined, // Default is enabled
      // history: undefined, // Default is enabled
      horizontalRule: false,
      // Disable lists in StarterKit as they are added separately
      orderedList: false, 
      bulletList: false, 
      listItem: false,
    }),
    // Re-add all extensions in intended order
    OrderedList,
    BulletList,
    ListItem,
    CustomCodeBlock,
    TaskList,
    TaskItem.configure({
      nested: true,
      ...(onReadOnlyChecked ? { onReadOnlyChecked } : {}),
    }),
    Underline,
    Link.configure({
      autolink: true,
      linkOnPaste: true,
      // Never open on click straight from the editor: shared todos can
      // contain links authored by other users.
      openOnClick: false,
      // Explicit allowlist instead of relying on the library default
      // (see issue #17): only http(s)/mailto, never javascript: & co.
      protocols: ALLOWED_LINK_PROTOCOLS,
      isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && isSafeLinkUrl(url),
    }),
    Highlight,
    Mention.configure(mentionOptions),
    Hashtag,
    // Re-enable Placeholder
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];

  const editorProps: EditorOptions['editorProps'] = {
    attributes: {
      class: `focus:outline-none`,
    },
  };

  return { extensions, editorProps };
} 