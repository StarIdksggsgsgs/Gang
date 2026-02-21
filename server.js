const express = require("express");
const fs = require("fs");
const fse = require("fs-extra");
const multer = require("multer");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const https = require("https");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: "uploads/" });

// ========== RUBIS UPLOAD ==========
async function uploadToRubis(title, content) {
    return new Promise((resolve, reject) => {
        const query = `?public=true&title=${encodeURIComponent(title)}`;
        const options = {
            hostname: "api.rubis.app",
            path: `/v2/scrap${query}`,
            method: "POST",
            headers: {
                "Content-Type": "text/plain",
                "Content-Length": Buffer.byteLength(content)
            }
        };
        const req = https.request(options, res => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.success && parsed.raw) resolve(parsed.raw);
                    else reject("Rubis upload failed");
                } catch { reject("Invalid Rubis response"); }
            });
        });
        req.on("error", reject);
        req.write(content);
        req.end();
    });
}

// ========== ENV DUMPER ==========
async function runDump(inputPath) {
    const output1 = `temp_output1_${Date.now()}.txt`;
    const output2 = `temp_output2_${Date.now()}.txt`;

    function isValid(file) {
        if (!fs.existsSync(file)) return false;
        const stats = fs.statSync(file);
        if (stats.size === 0) return false;
        const content = fs.readFileSync(file, "utf8").trim();
        if (!content) return false;
        return true;
    }

    try {
        // Using ANTINUKE8.lua.txt
        await execAsync(`lua ./ANTINUKE8.lua.txt "${inputPath}" "${output1}"`);
        await execAsync(`lua ./catnapdumper.lua.txt "${inputPath}" "${output2}"`);
    } catch {}

    let finalOutput;
    if (isValid(output1) && isValid(output2)) {
        const size1 = fs.statSync(output1).size;
        const size2 = fs.statSync(output2).size;
        finalOutput = size1 >= size2 ? output1 : output2;
    } else if (isValid(output1)) finalOutput = output1;
    else if (isValid(output2)) finalOutput = output2;
    else throw new Error("No valid output generated");

    const content = fs.readFileSync(finalOutput, "utf8");
    // clean up
    [output1, output2, inputPath].forEach(f => fs.existsSync(f) && fs.unlinkSync(f));

    return content;
}

// ========== API ROUTE ==========
app.post("/api/dump", upload.single("file"), async (req, res) => {
    try {
        let inputPath;
        if (req.file) {
            inputPath = req.file.path;
        } else if (req.body.code) {
            inputPath = `temp_input_${Date.now()}.lua`;
            fs.writeFileSync(inputPath, req.body.code);
        } else {
            return res.status(400).json({ error: "No file or code provided" });
        }

        const processed = await runDump(inputPath);
        let rubisURL;
        try { rubisURL = await uploadToRubis(`ENV Dump ${Date.now()}`, processed); } catch {}
        res.json({ success: true, processed, rubisURL: rubisURL || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
