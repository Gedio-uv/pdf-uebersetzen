"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, FileText, Loader2, CheckCircle2, Download, AlertCircle } from "lucide-react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "extracting" | "translating" | "generating" | "success" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      resetState();
    }
  };

  const resetState = () => {
    setStatus("idle");
    setProgress(0);
    setTotalChunks(0);
    setErrorMessage("");
    setDownloadUrl("");
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const dropped = e.dataTransfer.files[0];
      if (dropped.type === "application/pdf") {
        setFile(dropped);
        resetState();
      } else {
        setStatus("error");
        setErrorMessage("Please upload a valid PDF file.");
      }
    }
  };

  const startProcess = async () => {
    if (!file) return;
    
    try {
      // 1. Extract
      setStatus("extracting");
      const formData = new FormData();
      formData.append("file", file);
      
      const extractRes = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });
      
      if (!extractRes.ok) {
        const errText = await extractRes.text();
        let errMsg = `Server Error (${extractRes.status}): ${errText.slice(0, 100)}`;
        try { 
          const err = JSON.parse(errText); 
          errMsg = err.detail || errMsg; 
        } catch(e) {}
        throw new Error(errMsg);
      }
      
      const extractData = await extractRes.json();
      const chunks: string[] = extractData.chunks;
      
      if (!chunks || chunks.length === 0) {
        throw new Error("No readable text found in the PDF. Scanned images are not supported.");
      }
      
      setTotalChunks(chunks.length);
      setStatus("translating");
      
      // 2. Translate
      const allTranslatedClauses: any[] = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const translateRes = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunks[i] }),
        });
        
        if (!translateRes.ok) {
          const errText = await translateRes.text();
          let errMsg = `Translation failed at chunk ${i + 1} (Status ${translateRes.status})`;
          try { const err = JSON.parse(errText); errMsg = err.detail || errMsg; } catch(e) {}
          throw new Error(errMsg);
        }
        
        const translateData = await translateRes.json();
        allTranslatedClauses.push(...(translateData.clauses || []));
        setProgress(i + 1);
      }
      
      // 3. Generate
      setStatus("generating");
      const generateRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clauses: allTranslatedClauses }),
      });
      
      if (!generateRes.ok) {
         const errText = await generateRes.text();
         throw new Error(`Failed to generate PDF (Status ${generateRes.status})`);
      }
      
      const blob = await generateRes.blob();
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setStatus("success");
      
    } catch (err: any) {
      console.error(err);
      setStatus("error");
      setErrorMessage(err.message || "An unexpected error occurred.");
    }
  };

  const getProgressPercentage = () => {
    if (totalChunks === 0) return 0;
    return Math.round((progress / totalChunks) * 100);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative background blurs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none" />

      <div className="z-10 w-full max-w-2xl text-center mb-10">
        <motion.h1 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-5xl md:text-6xl font-bold tracking-tight mb-4 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400"
        >
          pdf übersetzen
        </motion.h1>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-gray-400 text-lg"
        >
          Transform German PDF books into Kindle-optimized interlinear translations.
        </motion.p>
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className="z-10 w-full max-w-2xl glass rounded-3xl p-8"
      >
        <AnimatePresence mode="wait">
          {status === "idle" || status === "error" ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center"
            >
              <div 
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className="w-full h-64 border-2 border-dashed border-gray-600/50 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 transition-colors group relative"
              >
                <input 
                  type="file" 
                  accept="application/pdf" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
                
                {file ? (
                  <div className="flex flex-col items-center text-blue-400">
                    <FileText className="w-16 h-16 mb-4" />
                    <span className="font-medium">{file.name}</span>
                    <span className="text-sm text-gray-500 mt-2">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-gray-400 group-hover:text-gray-300 transition-colors">
                    <UploadCloud className="w-16 h-16 mb-4 text-gray-500 group-hover:text-blue-400 transition-colors" />
                    <span className="font-medium text-lg">Click or drag PDF here</span>
                    <span className="text-sm mt-2">Max limit depends on your device memory</span>
                  </div>
                )}
              </div>

              {status === "error" && (
                <div className="mt-6 flex items-center text-red-400 bg-red-400/10 px-4 py-3 rounded-xl w-full">
                  <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0" />
                  <p className="text-sm">{errorMessage}</p>
                </div>
              )}

              <button
                onClick={startProcess}
                disabled={!file}
                className={`mt-8 w-full py-4 rounded-xl font-bold text-lg transition-all ${
                  file 
                    ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:opacity-90 shadow-lg hover:shadow-blue-500/25" 
                    : "bg-gray-800 text-gray-500 cursor-not-allowed"
                }`}
              >
                Start Translation
              </button>
            </motion.div>
          ) : status === "success" ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center py-10"
            >
              <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 className="w-12 h-12 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Translation Complete!</h2>
              <p className="text-gray-400 mb-8 text-center">
                Your Kindle-optimized PDF is ready.
              </p>
              
              <a 
                href={downloadUrl} 
                download={`translated_${file?.name || "book.pdf"}`}
                className="flex items-center justify-center w-full py-4 bg-white text-black rounded-xl font-bold text-lg hover:bg-gray-100 transition-colors"
              >
                <Download className="w-5 h-5 mr-2" />
                Download PDF
              </a>
              
              <button 
                onClick={resetState}
                className="mt-4 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Translate another document
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center py-10"
            >
              <Loader2 className="w-16 h-16 text-blue-400 animate-spin mb-8" />
              
              <div className="w-full max-w-md">
                <div className="flex justify-between text-sm font-medium mb-2">
                  <span className="text-gray-300">
                    {status === "extracting" && "Reading Document..."}
                    {status === "translating" && `Translating Clauses...`}
                    {status === "generating" && "Generating Kindle PDF..."}
                  </span>
                  {status === "translating" && (
                    <span className="text-blue-400">{getProgressPercentage()}%</span>
                  )}
                </div>
                
                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ 
                      width: status === "extracting" ? "10%" : 
                             status === "translating" ? `${10 + (getProgressPercentage() * 0.8)}%` : 
                             "100%" 
                    }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                
                {status === "translating" && totalChunks > 0 && (
                  <p className="text-center text-xs text-gray-500 mt-4">
                    Processing chunk {progress} of {totalChunks}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </main>
  );
}
