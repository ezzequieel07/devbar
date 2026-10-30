// devbar: the toolbar. Outside development it renders nothing and its code isn't downloaded (client/Devbar loads it apart).
// Keep the condition in your root layout anyway, as a second lock:
//   {process.env.NODE_ENV === 'development' && <Devbar />}
// The server side lives in 'devbar/server' (and the content adapters in 'devbar/adapters/*').
export {default as Devbar, default} from './client/Devbar';
export type {DevbarProps} from './client/Toolbar';
export type {Messages} from './client/i18n';
export type {Leaf, Locale, RequestStatus, Target} from './types';
