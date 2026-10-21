import React, { useEffect, useRef, useState } from 'react';
import { animate, motion, useInView, useReducedMotion, type HTMLMotionProps } from 'framer-motion';

/**
 * The app's motion vocabulary: one place that decides how things enter, react and count, so every
 * screen moves the same way. Everything honours prefers-reduced-motion (content appears at once).
 */

const IS_TEST = import.meta.env.MODE === 'test';
// jsdom has no IntersectionObserver: in tests a number is simply shown
const useSeen = IS_TEST ? () => true : (ref: React.RefObject<Element>) => useInView(ref, { once: true });

export const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const;
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** A page entering: a short rise and fade. Keyed by the page, not by a task opened over it. */
export const PageTransition: React.FC<{ routeKey: string; children: React.ReactNode }> = ({ routeKey, children }) => {
  const reduce = useReducedMotion();
  if (reduce || IS_TEST) return <>{children}</>;
  return (
    <motion.div key={routeKey} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: EASE_OUT }}>
      {children}
    </motion.div>
  );
};

/** Children appear one after another (cards, rows of tiles). */
export const Stagger: React.FC<HTMLMotionProps<'div'> & { gap?: number }> = ({ gap = 0.045, children, ...rest }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce || IS_TEST ? false : 'hidden'}
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: 0.04 } } }}
      {...rest}
    >
      {children}
    </motion.div>
  );
};

export const StaggerItem: React.FC<HTMLMotionProps<'div'>> = ({ children, ...rest }) => (
  <motion.div
    variants={{ hidden: { opacity: 0, y: 10, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.36, ease: EASE_OUT } } }}
    {...rest}
  >
    {children}
  </motion.div>
);

/** A number that counts up to its value when it first scrolls into view, and glides to new values. */
export const AnimatedNumber: React.FC<{ value: number; className?: string }> = ({ value, className }) => {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useSeen(ref);
  const [shown, setShown] = useState(reduce || IS_TEST ? value : 0);
  const from = useRef(reduce || IS_TEST ? value : 0);
  useEffect(() => {
    if (reduce || IS_TEST) {
      setShown(value);
      return;
    }
    if (!inView) return;
    const controls = animate(from.current, value, {
      duration: Math.min(1.1, 0.35 + Math.abs(value - from.current) * 0.04),
      ease: EASE_OUT,
      onUpdate: (v) => setShown(Math.round(v)),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, inView, reduce]);
  return (
    <span ref={ref} className={className}>
      {shown.toLocaleString()}
    </span>
  );
};

/** The moving highlight behind the selected item of a segmented control or a nav list. */
export const SlidingHighlight: React.FC<{ layoutId: string; className?: string }> = ({ layoutId, className }) => {
  const reduce = useReducedMotion();
  return <motion.span aria-hidden layoutId={reduce ? undefined : layoutId} transition={SPRING} className={className} />;
};
