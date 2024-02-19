document.addEventListener('DOMContentLoaded', function() {
    var today = new Date().toISOString().split('T')[0]; // Gets today's date and formats it as YYYY-MM-DD
    document.getElementsByName("date")[0].setAttribute('max', today); // Sets the max attribute to today's date
});