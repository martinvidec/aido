'use client';

import React, { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import Image from 'next/image';

// Export SuggestionItem type
export interface SuggestionItem {
  id: string; // User UID
  label: string; // Display Name or Email
  photoURL?: string | null;
}

// Export SuggestionListProps type
export interface SuggestionListProps {
  items: SuggestionItem[];
  command: (item: SuggestionItem) => void; // Function to call when an item is selected
}

// Define the type for the ref handle
export interface SuggestionListRef {
  onKeyDown: ({ event }: { event: KeyboardEvent }) => boolean;
}

const SuggestionList = forwardRef<SuggestionListRef, SuggestionListProps>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = useCallback((index: number) => {
    const item = props.items[index];
    if (item) {
      props.command(item);
    }
  }, [props]);

  // Allow parent component (Tiptap mention config) to trigger actions via ref
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }): boolean => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
        return true; // Mark event as handled
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((selectedIndex + 1) % props.items.length);
        return true; // Mark event as handled
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex);
        return true; // Mark event as handled
      }
      return false; // Event not handled
    },
  }));

  // Reset index if items change
  useEffect(() => setSelectedIndex(0), [props.items]);

  if (props.items.length === 0) {
    return null; // Don't render if no suggestions
  }

  return (
    <div className="bg-bg-pop rounded-lg shadow-lg border border-border overflow-hidden z-50 max-h-60 overflow-y-auto">
      {props.items.map((item, index) => (
        <button
          key={item.id}
          className={`flex items-center w-full text-left px-3 py-2 text-sm ${
            index === selectedIndex
            ? 'bg-accent-soft'
            : 'hover:bg-row-hover'
          }`}
          onClick={() => selectItem(index)}
        >
           {/* Optional Avatar */}
           <div className="relative w-6 h-6 mr-2 rounded-full overflow-hidden border border-border flex-shrink-0">
              {item.photoURL ? (
                  <Image src={item.photoURL} alt={item.label} fill className="object-cover" />
              ) : (
                  <div className="w-full h-full bg-row-hover flex items-center justify-center">
                     <span className="text-xs text-text-dim">
                        {item.label?.[0]?.toUpperCase() || '?'}
                     </span>
                  </div>
              )}
            </div>
          <span className="text-text truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
});

SuggestionList.displayName = 'SuggestionList';

export default SuggestionList; 