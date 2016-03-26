import Rx from 'rx';

/**
 * Splits the results of a node-style-callback into elements and errors
 */
function nodeResultSelector ( err, result ) {
  if( err )
    throw err;
  else
    return result;
}

/**
 * Creates an observable from a function that takes a node-style-callbac-function
 * as the last argument.
 *
 * @param  {function}   f
 * @param  {Object}     context
 * @return {Observable}
 */
export default function observableFromNodeCallback( f, context ) {
  return Rx.Observable.fromCallback( f, context, nodeResultSelector );
}
