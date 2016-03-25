import Rx from 'rx';

function nodeResultSelector ( err, result ) {
  if( err )
    throw err;
  else
    return result;
}

export default function observableFromNodeCallback( f, context ) {
  return Rx.Observable.fromCallback( f, context, nodeResultSelector );
}
