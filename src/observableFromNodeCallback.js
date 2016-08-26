import Rx from 'rx';

/**
 * Creates an observable from a function that takes a node-style-callbac-function
 * as the last argument.
 *
 * @param  {function}   f
 * @param  {Object}     context
 * @return {Observable}
 */
export default function observableFromNodeCallback( f, context ) {
  // fromNodeCallback already calls the function f, even if not subscribed to
  // we thus wrap it in a new observable
  return ( ...args ) =>
    Rx.Observable.create( observer => {
      const nodeFunc = Rx.Observable.fromNodeCallback( f, context );
      const source$ = nodeFunc( ...args )
      source$.subscribe( observer );
    } );
}
