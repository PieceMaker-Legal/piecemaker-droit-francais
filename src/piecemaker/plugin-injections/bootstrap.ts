import { startPluginInjections } from '@/piecemaker/plugin-injections';

const stopPluginInjections = startPluginInjections();
if (import.meta.hot) import.meta.hot.dispose(stopPluginInjections);
