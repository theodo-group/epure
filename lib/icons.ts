// `@theodo-group/epure/icons`: the bundled icon catalog (~9.4k icons) and its
// zero-dependency search. Pure data + functions, safe in browser and Node.
//
//   search('postgres', { provider: 'aws' })   icon('aws/database/rds')
//   url('aws/database/rds')                   providers / provider('gcp')
//
// The image files themselves ship under `dist/icons/`: per file via the
// `@theodo-group/epure/icons/files/*` subpath, or on disk via
// `packagedIconsDir()` from `@theodo-group/epure/render`.

export {
  catalog,
  icon,
  url,
  search,
  providers,
  provider,
  type IconMeta,
  type Provider,
  type SearchOptions,
} from '../src/icons'
