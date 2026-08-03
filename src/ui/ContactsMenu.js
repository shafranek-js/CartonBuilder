export function createContactsMenu({
  triggerButton,
  popoverContainer,
  documentRef = document,
  onOpen = () => {},
}) {
  let isOpen = false;

  function togglePopover(open) {
    isOpen = open !== undefined ? open : !isOpen;
    popoverContainer.hidden = !isOpen;
    triggerButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) onOpen();
  }

  triggerButton.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePopover();
  });

  popoverContainer.addEventListener('click', (event) => {
    if (event.target.closest('a')) togglePopover(false);
  });

  documentRef.addEventListener('click', (event) => {
    if (isOpen && !popoverContainer.contains(event.target) && !triggerButton.contains(event.target)) {
      togglePopover(false);
    }
  });

  documentRef.addEventListener('keydown', (event) => {
    if (isOpen && event.key === 'Escape') togglePopover(false);
  });

  return { togglePopover };
}
