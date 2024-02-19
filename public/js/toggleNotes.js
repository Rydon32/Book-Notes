document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".note-toggle").forEach(function (button) {
    button.addEventListener("click", function () {
      let card = this.closest(".card"); // Find the closest ancestor which is a card
      if (card.style.height) {
        card.style.height = ""; // Reset the card height when notes are collapsed
      } else {
        card.style.height = "auto"; // Allow the card to grow according to its content
      }
      let noteText = this.previousElementSibling; // Assumes the note text is immediately before the button
      if (noteText.style.height) {
        noteText.style.height = ""; // Remove the height limit
        this.textContent = "Show More"; // Change the button text back
        noteText.classList.add("note-text"); // Add ellipsis back
      } else {
        noteText.style.height = "auto"; // Allow the div to expand to full height
        this.textContent = "Show Less"; // Change the button text
        noteText.classList.remove("note-text"); // Remove ellipsis
      }
    });
  });
});
