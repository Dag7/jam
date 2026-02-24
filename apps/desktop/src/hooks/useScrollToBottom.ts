/**
 * useScrollToBottom Hook
 *
 * Anchor-based scroll-to-bottom for chat views.
 * Uses scrollIntoView on an anchor div instead of container.scrollTo(scrollHeight)
 * to avoid timing issues with container height calculations.
 *
 * Features:
 * - IntersectionObserver on anchor detects if user is at bottom
 * - MutationObserver + ResizeObserver auto-scroll during streaming
 * - Scroll listener detects user-initiated scroll-up
 * - Pointer guard suppresses auto-scroll briefly on clicks (widget expansion)
 * - Callback ref handles dynamic container mounting
 *
 * Adapted from Vercel AI Chatbot pattern (PR #970).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface UseScrollToBottomReturn {
  /** Callback ref — attach to the scroll container's ref prop */
  containerRef: (node: HTMLDivElement | null) => void;
  /** Regular ref for reading the container DOM node */
  containerNode: React.MutableRefObject<HTMLDivElement | null>;
  /** Ref for an anchor div placed at the bottom of the message list */
  endRef: React.RefObject<HTMLDivElement>;
  /** Whether the user can see the bottom of the chat */
  isAtBottom: boolean;
  /** Whether to show the "scroll to bottom" button */
  showScrollButton: boolean;
  /** Scroll to the bottom of the chat */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** Reset state and scroll to bottom (call on conversation change) */
  reset: () => void;
  /** Attach to onPointerDown on the scroll container */
  onContainerPointerDown: () => void;
}

export function useScrollToBottom(): UseScrollToBottomReturn {
  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null!);

  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerNodeRef.current = node;
    setContainer(node);
  }, []);

  const shouldAutoScrollRef = useRef(true);
  const userInteractingRef = useRef(false);
  const interactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'instant') => {
      shouldAutoScrollRef.current = true;
      setIsAtBottom(true);
      endRef.current?.scrollIntoView({ behavior });
    },
    [],
  );

  const reset = useCallback(() => {
    shouldAutoScrollRef.current = true;
    setIsAtBottom(true);
    endRef.current?.scrollIntoView({ behavior: 'instant' });
  }, []);

  const onContainerPointerDown = useCallback(() => {
    userInteractingRef.current = true;
    if (interactionTimeoutRef.current) {
      clearTimeout(interactionTimeoutRef.current);
    }
    interactionTimeoutRef.current = setTimeout(() => {
      userInteractingRef.current = false;
    }, 500);
  }, []);

  // IntersectionObserver: is the anchor visible?
  useEffect(() => {
    const end = endRef.current;
    if (!container || !end) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting;
        setIsAtBottom(visible);
        if (visible) {
          shouldAutoScrollRef.current = true;
        }
      },
      { root: container },
    );

    observer.observe(end);
    return () => observer.disconnect();
  }, [container]);

  // Scroll listener: detect user-initiated scroll-up
  useEffect(() => {
    if (!container) return;

    let lastScrollTop = container.scrollTop;

    const handleScroll = () => {
      const { scrollTop } = container;
      const scrollingUp = scrollTop < lastScrollTop;
      lastScrollTop = scrollTop;

      if (scrollingUp) {
        shouldAutoScrollRef.current = false;
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (interactionTimeoutRef.current) {
        clearTimeout(interactionTimeoutRef.current);
      }
    };
  }, [container]);

  // MutationObserver + ResizeObserver: auto-scroll during streaming
  useLayoutEffect(() => {
    const end = endRef.current;
    if (!container || !end) return;

    const onContentChange = () => {
      if (userInteractingRef.current) return;
      if (!shouldAutoScrollRef.current) return;
      end.scrollIntoView({ behavior: 'instant' });
    };

    const mo = new MutationObserver(onContentChange);
    mo.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const ro = new ResizeObserver(onContentChange);
    ro.observe(container);

    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, [container]);

  return {
    containerRef,
    containerNode: containerNodeRef,
    endRef,
    isAtBottom,
    showScrollButton: !isAtBottom,
    scrollToBottom,
    reset,
    onContainerPointerDown,
  };
}
