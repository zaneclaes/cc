
$(function(){
  $('.deltas').each(function(){
    var keys = ['paragraphs','limit','thumbnail','noframes'],
        opts = '';
    for (var k in keys) {
      var v = $(this).data(keys[k]);
      if (typeof v !== 'undefined') {
        opts += (opts.length ? '&' : '') + keys[k] + '=' + v;
      }
    }
    opts = opts && opts.length ? ('?'+opts) : '';
    console.log('opt',$(this).data('options'),opts);
    $(this).load('//www.deltas.io/api/v1/streams/' + $(this).data('stream') + '.html' + opts );
  });
})