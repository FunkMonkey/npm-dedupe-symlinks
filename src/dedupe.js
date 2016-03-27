import Rx from 'rx';
import path from 'path';
import fs from 'fs-extra';
import child_process from 'child_process';

import observableFromNodeCallback from './observableFromNodeCallback';

// TODO: move to fs-rx
const symlink = observableFromNodeCallback( fs.symlink );
const unlink = observableFromNodeCallback( fs.unlink );
const move = observableFromNodeCallback( fs.move );
const copy = observableFromNodeCallback( fs.copy );
const ensureDir = observableFromNodeCallback( fs.ensureDir );
const remove = observableFromNodeCallback( fs.remove );
const exists = ( path ) => Rx.Observable.fromCallback( fs.stat, fs, (err, result) => result == null ? false : true )( path ); // TODO check for EOENT

const info = console.info.bind( console );

/**
 * Moves the `node_modules` sub-folder from one directory to another
 * @param  {string}      from
 * @param  {string}      to
 * @return {Observable}        Empty or trash.
 */
function moveNodeModules( from, to ) {
  const fromPath = path.join( from, "node_modules" );
  const toPath = path.join( to, "node_modules" );

  return exists( fromPath )
    .flatMap( doesExist => doesExist ? move(fromPath, toPath)
                                     : Rx.Observable.empty() );
}

/**
 * Moves the `package.json` from one directory to another
 * @param  {string}      from
 * @param  {string}      to
 * @return {Observable}        Empty or trash.
 */
function copyPackageJSON( from, to ) {
  const fromPath = path.join( from, "package.json" );
  const toPath = path.join( to, "package.json" );

  return exists( fromPath )
    .flatMap( doesExist => doesExist ? copy(fromPath, toPath)
                                     : Rx.Observable.empty() );
}

// TODO: don't log to the console
/**
 * Spawns the `npm dedupe` process in the given directory. Logs to the console.
 *
 * @param  {string}                     dirPath
 * @return {Observable.<ChildProcess>}           Observable with single element
 */
function spawnNPMDedupe( dirPath ) {
  return Rx.Observable.create( observer => {
    info( "deduping", dirPath );

    // we need 'shell' for windows
    const ls = child_process.spawn( 'npm', ['dedupe'], { cwd: dirPath, env: process.env, shell: true } );
    observer.onNext( ls );

    ls.stdout.on( 'data', data => {
      info( data.toString() );
    } );

    ls.stderr.on( 'data', data => {
      console.error( data.toString() );
    });

    ls.on( 'close', code => {
      info( `'npm dedupe' exited with code ${code}` );
      if( code === 0 )
        observer.onCompleted();
      else
        observer.onError( new Error( code ) );
    });

  });
}


// TODO: don't log to the console
// TODO: prevent duplication calculations ($allSymlinks)
/**
 * Performs the actuall deduplication (including moving `node_modules`) in the
 * given directory for the given symlinked modules.
 *
 * @param  {string}             dirPath
 * @param  {SymlinkedModule[]}  linkedModules   List of modules (most likely retrieved by using `getSymlinkedModules`)
 * @return {Observable}                         Only contains rubbish
 */
export default function dedupe( dirPath, linkedModules ) {

  const $allModules = Rx.Observable.fromArray( linkedModules );

  const $modulesFromSymlinkedScopesGrouped = $allModules
    .filter( val => val.hasSymlinkedScope )
    .groupBy( mod => mod.scopePath, mod => mod );

  const $scopeSymlinks = $modulesFromSymlinkedScopesGrouped
    .flatMap( scope => scope.first().map( mod => ({
      path: mod.scopePath,
      target: mod.scopeTarget
    }) ) );

  const $symlinkedModules = $allModules.filter( val => !val.hasSymlinkedScope );

  const $allSymlinks = Rx.Observable.merge( $scopeSymlinks, $symlinkedModules);

  const tasks = [
    // unlink symbolic links
    $allSymlinks
      .tap( link => info( `unlinking '${link.path}' from '${link.target}'` ) )
      .flatMap( link => unlink( link.path ) ),

    // creating empty directory for every module
    $allModules
      .tap( mod => info( `creating directory '${mod.path}'` ) )
      .flatMap( mod => ensureDir( path.dirname( mod.path ) ) ),

    // copying package.json into directory structure that will be deduped
    $allModules
      .tap( mod => info( `copying package.json from '${mod.target}' to '${mod.path}'` ) )
      .flatMap( mod => copyPackageJSON( mod.target, mod.path ) ),

    // move node_modules into directory structure that will be deduped
    $allModules
      .tap( mod => info( `moving node_modules from '${mod.target}' to '${mod.path}'` ) )
      .flatMap( mod => moveNodeModules( mod.target, mod.path ) ),

    spawnNPMDedupe( dirPath ),

    // move deduped node_modules back into its original module
    $allModules
      .tap( mod => info( `moving node_modules from '${mod.path}' to '${mod.target}'` ) )
      .flatMap( mod => moveNodeModules( mod.path, mod.target ) ),

    // remove created folder structure
    $allSymlinks
      .tap( link => info( `removing directory '${link.path}'` ) )
      .flatMap( link => remove( link.path ) ),

    // re-create symlinks
    $allSymlinks
      .tap( link => info( `relinking '${link.path}' to '${link.target}'` ) )
      .flatMap( link => symlink( link.target, link.path, 'junction' ) ),

    Rx.Observable.just( 'DONE' )
  ];

  // executing the tasks
  return Rx.Observable.fromArray( tasks )
    .concatMap( o => o )
    .last();
}
