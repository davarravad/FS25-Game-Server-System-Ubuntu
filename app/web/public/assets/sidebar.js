(() => {
  const navigation = document.querySelector('.panel-navigation');
  if (!navigation) return;
  const mobile = window.matchMedia('(max-width: 800px)');
  const sync = () => { navigation.open = !mobile.matches; };
  mobile.addEventListener('change', sync);
  sync();
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobile.matches && navigation.open) {
      navigation.open = false;
      navigation.querySelector('summary').focus();
    }
  });
  document.addEventListener('click', event => {
    if (mobile.matches && !navigation.contains(event.target)) navigation.open = false;
  });
})();
