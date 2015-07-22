function loadHash(hash) {
  var h = hash.substr(1),
      streamId = $('#stream').attr('data-stream-id'),
      streamCn = $('#stream').attr('data-stream-cn'),
      container = $('#'+h),
      icon = $('#stream-'+h+'-icon'),
      classes = (icon.attr('class') || '').split(' '),
      iconClass = classes[classes.length - 1],
      restoreClass = function() {
        icon.removeClass("fa-circle-o-notch").removeClass("fa-spin").addClass(iconClass); 
      },
      loadHash = function() {
        if(container.children().length > 0) {
          return;
        }
        icon.removeClass(iconClass).addClass("fa-circle-o-notch fa-spin");
        container.load('/streams/'+streamId+'/'+h, restoreClass);
      };
  if (hash === '#preview') {
    $('#stream-preview').empty();
    $('body').scrollTop();
    icon.removeClass(iconClass).addClass("fa-circle-o-notch fa-spin");
    $.get('/api/v1/streams/' + streamCn + '.html?template=manage', function( data ) {
      $('#stream-preview').html(data);
      restoreClass();
    });
  } else if(hash.indexOf('#delta-') === 0 || hash.indexOf('#source-') === 0 || hash.indexOf('#fork-') === 0) {
    var objId = hash.split('-')[1],
        objType = hash.split('-')[0].substring(1);
    $('#stream').children().removeClass('active');
    $('#'+objType).addClass('active').children().css({'display':'none'});
    $(hash).css({'display':''});
  } else if(hash === '#integration') {
    // NOP
  } else {
    loadHash();
  }
}

$.fn.OneClickSelect = function () {
  return $(this).on('click', function () {

    // In here, "this" is the element

    var range, selection;

    // non-IE browsers account for 60% of users, this means 60% of the time,
    // the two conditions are evaluated since you check for IE first. 

    // Instead, reverse the conditions to get it right on the first check 60% of the time.

    if (window.getSelection) {
      selection = window.getSelection();
      range = document.createRange();
      range.selectNodeContents(this);
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (document.body.createTextRange) {
      range = document.body.createTextRange();
      range.moveToElementText(this);
      range.select();
    }
  });
};

$(function(){
  $('.dropdown-toggle').dropdown();
  var hash = (window.location.hash || '#integration'),
      show = ['#preview','#integration','#'];
  $('#stream-tabs a[href="' + (show.indexOf(hash)>=0 ? hash : '#') + '"]').tab('show');
  loadHash(hash);

  $('.hashable').click(function (e) {
    $(this).tab('show');
    window.location.hash = this.hash;
    loadHash(this.hash);
  });
  $('code').OneClickSelect();

  // Enable editable
  $('form.editable .clickable').click(function() {
    var form = $(this).parent('form.editable').first();
    form.children('input, button, textarea').show();
    form.children('.clickable').hide();
  });
  // Disable editable
  $('form.editable input').blur(function() {
    var form = $(this).parent('form.editable').first(),
        buttons = form.children('button');
    if (buttons.length === 0) {
      // Don't hide if there's a submit button.
      form.children('.clickable').show();
      form.children('input, button, textarea').hide();
    }
  });
});
