import {Suspense, lazy, useEffect, useState} from 'react';
import type {DevbarProps} from './Toolbar';

// The entry point stays tiny: the toolbar itself is loaded apart and only when it will show, so a published site never
// downloads its code (a plain import would ship it, even behind `NODE_ENV === 'development' &&` in a server layout).
// It only exists in the browser, so it mounts after hydration: the server renders nothing and there is nothing to hydrate.
const Toolbar = lazy(() => import('./Toolbar'));

/** Bundlers replace this expression with the build's value; without a bundler `process` doesn't exist in the browser. */
function isDevelopment() {
  try {
    return process.env.NODE_ENV === 'development';
  } catch {
    return false;
  }
}

export default function Devbar({enabled, ...props}: DevbarProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !(enabled ?? isDevelopment())) return null;
  return <Suspense fallback={null}><Toolbar {...props} /></Suspense>;
}
