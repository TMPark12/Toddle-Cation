"use strict";

const feelingsScreen = document.getElementById("feelings-screen");
const reasonsScreen = document.getElementById("reasons-screen");
const voiceToggle = document.getElementById("voice-toggle");
const status = document.getElementById("status");
const save = document.getElementById("save");
const choices = Array.from(document.querySelectorAll(".choice"));
let selectedColor = "";
let voiceEnabled = false;

function speak(text) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    status.textContent = "Voice is not available on this device. You can still read the questions.";
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter(voice => /^en(-|_)/i.test(voice.lang));
  utterance.voice = english.find(voice => /female|samantha|victoria|karen|moira|tessa|fiona|zira|susan/i.test(voice.name)) || english[0] || null;
  utterance.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

voiceToggle.addEventListener("click", () => {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    status.textContent = "Voice is not available on this device. You can still read the questions.";
    return;
  }
  voiceEnabled = !voiceEnabled;
  voiceToggle.setAttribute("aria-pressed", String(voiceEnabled));
  voiceToggle.textContent = voiceEnabled ? "Turn voice off" : "Turn voice on";
  status.textContent = "";
  if (voiceEnabled) {
    speak(reasonsScreen.hidden ? "How do you feel today?" : "Why do you feel this way?");
  } else if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
});

document.querySelectorAll("[data-speak]").forEach(button => {
  button.addEventListener("click", () => speak(button.dataset.speak));
});

document.querySelectorAll("[data-color]").forEach(button => {
  button.addEventListener("click", () => {
    selectedColor = button.dataset.color;
    feelingsScreen.hidden = true;
    reasonsScreen.hidden = false;
    status.textContent = "";
    document.getElementById("reasons-title").focus();
    if (voiceEnabled) speak("Why do you feel this way?");
  });
});

choices.forEach(button => {
  button.addEventListener("click", () => {
    button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
    save.disabled = !choices.some(choice => choice.getAttribute("aria-pressed") === "true");
    status.textContent = "";
  });
});

document.getElementById("back").addEventListener("click", () => {
  reasonsScreen.hidden = true;
  feelingsScreen.hidden = false;
  document.querySelector(`[data-color="${selectedColor}"]`).focus();
  if (voiceEnabled) speak("How do you feel today?");
});

function makePdf(color, reasons, date) {
  const escape = text => text.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&");
  const lines = [
    "Toddle-Cation - Feelings report",
    `Date: ${date}`,
    "How do you feel today?",
    `Color: ${color}`,
    "Why do you feel this way?",
    "Pictures:",
    ...Array.from({ length: Math.ceil(reasons.length / 3) }, (_, index) => reasons.slice(index * 3, index * 3 + 3).join(", "))
  ];
  const content = `BT\n/F1 18 Tf\n72 740 Td\n${lines.map((line, index) => `${index ? "0 -32 Td\n" : ""}(${escape(line)}) Tj`).join("\n")}\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([pdf], { type: "application/pdf" });
}

save.addEventListener("click", () => {
  const reasons = choices.filter(choice => choice.getAttribute("aria-pressed") === "true").map(choice => choice.dataset.reason);
  if (!selectedColor || !reasons.length) return;
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const url = URL.createObjectURL(makePdf(selectedColor, reasons, date));
  const link = document.createElement("a");
  link.href = url;
  link.download = `toddle-cation-${Date.now()}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  status.textContent = "Your report is ready. Check your downloads or save it to Files.";
});
