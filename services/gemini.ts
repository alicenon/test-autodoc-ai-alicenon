import { GoogleGenAI } from "@google/genai";
// import.meta.env.VITE_GEMINI_API_KEY


// Helper to clean the tree for the prompt (reduce tokens)
const simplifyTreeForPrompt = (paths: string[]): string => {
  // Take the first 300 paths to avoid token limits on huge repos
  const limitedPaths = paths.slice(0, 300);
  return limitedPaths.join('\n');
};
// process.env.GEMINI_API_KEY is set in vite.config.ts

const getClient = () => {
    if (!import.meta.env.VITE_GEMINI_API_KEY) { 
        console.log("VITE_GEMINI_API_KEY:", import.meta.env.VITE_GEMINI_API_KEY);
        throw new Error("API Key is missing.");
    }
    console.log("VITE_GEMINI_API_KEY:", import.meta.env.VITE_GEMINI_API_KEY);
    return new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY});
};

export const analyzeRepoArchitecture = async (filePaths: string[]): Promise<string> => {
  try {
    const ai = getClient();
    const treeString = simplifyTreeForPrompt(filePaths);
    
    const prompt = `
      You are a Senior Software Architect. 
      Analyze the following file structure of a GitHub repository and provide a concise technical summary.
      
      File Structure (truncated):
      ${treeString}

      Please provide the output in Markdown format with the following sections:
      1. **Tech Stack**: Detect languages, frameworks, and build tools.
      2. **Architecture**: Guess the architectural pattern (e.g., Monorepo, MVC, Clean Architecture).
      3. **Key Directories**: Explain the purpose of important folders (e.g., src, lib, api).
      4. **Purpose**: Infer what this application does.

      Keep it professional and concise.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.2,
      }
    });

    return response.text || "Could not generate analysis.";
  } catch (error: any) {
    console.error("Gemini Analysis Error:", error);
    return `Failed to analyze repository structure: ${error.message || 'Unknown error'}`;
  }
};

export const generateCodeDocumentation = async (fileName: string, fileContent: string): Promise<string> => {
    try {
        const ai = getClient();
        
        // Truncate extremely large files to fit context window if necessary, though 2.5 flash has a huge window.
        // Safety truncation to 50k chars roughly.
        const contentToAnalyze = fileContent.length > 100000 ? fileContent.substring(0, 100000) + "\n...[File Truncated]" : fileContent;

        const prompt = `
            You are an automated documentation generator tool (like Sphinx, Javadoc, or Docusaurus).
            
            TASK: Generate comprehensive technical documentation for the following code file: "${fileName}".
            
            INSTRUCTIONS:
            1. Analyze the code, specifically looking for docstrings, comments, function signatures, and class definitions.
            2. If docstrings exist, use them as the primary source of truth.
            3. If docstrings are missing, infer the functionality based on the code logic.
            4. Format the output as professional Markdown suitable for a developer portal.
            
            OUTPUT FORMAT:
            # [Filename]
            
            ## Overview
            [Brief description of what this module/file does]
            
            ## Classes / Components (if applicable)
            ### [ClassName]
            - Description...
            
            ## Functions / Methods
            ### \`functionName(params)\`
            - **Description**: [What it does]
            - **Parameters**:
              - \`param\`: [Type] - [Description]
            - **Returns**: [Type] - [Description]
            
            ## Usage Example (Optional, if easy to infer)
            \`\`\`
            [Code snippet]
            \`\`\`

            CODE TO ANALYZE:
            ${contentToAnalyze}
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                temperature: 0.2,
            }
        });

        return response.text || "Could not generate documentation.";

    } catch (error: any) {
        console.error("Gemini Doc Generation Error:", error);
        return `Failed to generate documentation: ${error.message || 'Unknown error'}`;
    }
};