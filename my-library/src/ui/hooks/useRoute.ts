import { useEffect, useState } from 'react';

export type Route = { name: 'library' } | { name: 'book'; id: string; autoplay: boolean } | { name: 'settings' };

function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [first, second] = path.split('/');
  if (first === 'book' && second) return { name: 'book', id: decodeURIComponent(second), autoplay: query.split('&').includes('play') };
  if (first === 'settings') return { name: 'settings' };
  return { name: 'library' };
}

/** Hash routing works from any URL path and offline, with no server config. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

let navigatedInApp = false;

export function navigate(to: string) {
  navigatedInApp = true;
  location.hash = to;
}

/** Go back if we came from inside the app, otherwise go to the library. */
export function goBack() {
  if (navigatedInApp) history.back();
  else location.hash = '/';
}
