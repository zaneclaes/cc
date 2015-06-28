function loadHash(hash) {
  var h = hash.substr(1),
      streamId = $('#stream').attr('data-stream-id'),
      container = $('#'+h),
      icon = $('#stream-'+h+'-icon'),
      classes = (icon.attr('class') || '').split(' '),
      iconClass = classes[classes.length - 1],
      restoreClass = function() {
        icon.removeClass("fa-circle-o-notch").removeClass("fa-spin").addClass(iconClass); 
      },
      loadHash = function() {
        icon.removeClass(iconClass).addClass("fa-circle-o-notch fa-spin");
        container.load('/streams/'+streamId+'/'+h, restoreClass);
      };
  if (hash === '#preview') {
    icon.removeClass(iconClass).addClass("fa-circle-o-notch fa-spin");
    $.getJSON('/api/v1/streams/' + streamId, function( data ) {
      container.append('<code>'+ JSON.stringify(data) + '</code>');
      restoreClass();
    });
  } else if(hash.indexOf('#delta-') === 0) {
    var deltaId = hash.substr('#delta-'.length);
    $('#stream').children().removeClass('active');
    $('#delta').addClass('active').children().css({'display':'none'});
    $(hash).css({'display':''});
  } else {
    loadHash();
  }
}

$(function(){
  $('.dropdown-toggle').dropdown();
  var hash = (window.location.hash || '#preview'),
      show = ['#preview','#integration','#'];
  $('#stream-tabs a[href="' + (show.indexOf(hash)>=0 ? hash : '#') + '"]').tab('show');
  loadHash(hash);

  $('.hashable').click(function (e) {
    $(this).tab('show');
    var scrollmem = $('body').scrollTop();
    window.location.hash = this.hash;
    $('html,body').scrollTop(scrollmem);
    loadHash(this.hash);
  });
});