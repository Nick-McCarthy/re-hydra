// Export the open program as a re-hydra import.
// Run this from the Code Browser after analysis. Save the JSON, then drop it
// on the project board. See the FAQ section
// "How does a project owner set up a project?"
//@category Export
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.AddressRange;
import ghidra.program.model.address.AddressRangeIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import ghidra.program.model.symbol.SymbolType;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;
import java.io.File;
import java.io.FileInputStream;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Base64;

public class ExportReHydra extends GhidraScript {
	private static final int DECOMPILE_TIMEOUT_SEC = 30;
	/** 0 exports every defined function. Set a positive count to stop after that many. */
	private static final int MAX_FUNCTIONS = 0;
	/** Names re-hydra accepts. Others are left out of the symbol list. */
	private static final Pattern SYMBOL_NAME = Pattern.compile("^[A-Za-z0-9_:<>~,.*&()\\[\\]+=!$@?`' -]{1,256}$");
	private static final int MAX_SYMBOLS = 200000;

	@Override
	public void run() throws Exception {
		File programFile = new File(currentProgram.getExecutablePath());
		if (!programFile.isFile()) {
			println("The imported file is not at " + programFile.getPath() + ". Put it back, then run this script again.");
			return;
		}
		File out = askFile("Save re-hydra export", "Save");
		DecompInterface decomp = new DecompInterface();
		if (!decomp.openProgram(currentProgram)) {
			println("The decompiler could not open this program.");
			return;
		}
		JsonArray functions = new JsonArray();
		int skipped = 0;
		FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
		while (it.hasNext() && !monitor.isCancelled()) {
			if (MAX_FUNCTIONS > 0 && functions.size() >= MAX_FUNCTIONS) {
				break;
			}
			Function function = it.next();
			JsonObject row = exportFunction(decomp, function);
			if (row == null) {
				skipped++;
				continue;
			}
			functions.add(row);
			println("exported " + function.getName());
		}
		decomp.dispose();
		if (functions.size() == 0) {
			println("No functions were exported. Skipped " + skipped + ".");
			return;
		}

		JsonObject root = new JsonObject();
		root.addProperty("binarySha256", sha256(programFile));
		root.addProperty("arch", currentProgram.getLanguage().getProcessor().toString());
		root.addProperty("name", currentProgram.getName());
		root.addProperty("language", currentProgram.getLanguageID().getIdAsString());
		root.addProperty("types", "");
		root.add("functions", functions);
		JsonArray symbols = exportSymbols();
		root.add("symbols", symbols);
		Files.writeString(out.toPath(), new GsonBuilder().setPrettyPrinting().create().toJson(root));
		println("Wrote " + functions.size() + " functions and " + symbols.size() + " symbols, skipped " + skipped + ", to " + out.getAbsolutePath());
	}

	private JsonObject exportFunction(DecompInterface decomp, Function function) {
		if (function.isExternal() || function.isThunk()) {
			return null;
		}
		AddressRange range = singleRange(function);
		if (range == null || range.getLength() <= 0 || range.getLength() > Integer.MAX_VALUE) {
			return null;
		}
		int size = (int) range.getLength();
		byte[] raw = new byte[size];
		try {
			currentProgram.getMemory().getBytes(range.getMinAddress(), raw);
		} catch (Exception ex) {
			return null;
		}
		JsonObject row = new JsonObject();
		row.addProperty("name", function.getName());
		// Body start, not the entry point. On some functions the entry sits
		// inside the body, and entry-plus-length then runs into the next function.
		row.addProperty("address", hexAddress(range.getMinAddress().getOffset()));
		row.addProperty("size", size);
		row.addProperty("bytesBase64", Base64.getEncoder().encodeToString(raw));
		row.addProperty("pseudocode", decompile(decomp, function));
		row.addProperty("disassembly", disassemble(function));
		JsonArray callees = new JsonArray();
		for (Function callee : function.getCalledFunctions(monitor)) {
			if (callee.isExternal()) {
				continue;
			}
			AddressRange calleeBody = singleRange(callee);
			long calleeStart = calleeBody != null
				? calleeBody.getMinAddress().getOffset()
				: callee.getEntryPoint().getOffset();
			callees.add(hexAddress(calleeStart));
		}
		row.add("callees", callees);
		return row;
	}

	/**
	 * Addresses of globals and of functions that are not chunks (thunks such as
	 * PLT stubs). The integration build links references to these names at
	 * their original addresses, so a matched function's data accesses and
	 * library calls are checked too. External symbols have no address here.
	 */
	private JsonArray exportSymbols() {
		JsonArray symbols = new JsonArray();
		Set<String> seen = new HashSet<>();
		SymbolIterator it = currentProgram.getSymbolTable().getAllSymbols(true);
		while (it.hasNext() && !monitor.isCancelled() && symbols.size() < MAX_SYMBOLS) {
			Symbol symbol = it.next();
			if (symbol.isExternal() || !symbol.isPrimary() || !symbol.getAddress().isMemoryAddress()) {
				continue;
			}
			String kind;
			if (symbol.getSymbolType() == SymbolType.FUNCTION) {
				Function function = currentProgram.getFunctionManager().getFunctionAt(symbol.getAddress());
				if (function == null || !function.isThunk()) {
					continue;
				}
				kind = "function";
			} else if (symbol.getSymbolType() == SymbolType.LABEL) {
				MemoryBlock block = currentProgram.getMemory().getBlock(symbol.getAddress());
				if (block == null || block.isExecute()) {
					continue;
				}
				kind = "data";
			} else {
				continue;
			}
			String name = symbol.getName();
			if (!SYMBOL_NAME.matcher(name).matches() || !seen.add(name)) {
				continue;
			}
			JsonObject row = new JsonObject();
			row.addProperty("name", name);
			row.addProperty("address", hexAddress(symbol.getAddress().getOffset()));
			row.addProperty("kind", kind);
			symbols.add(row);
		}
		return symbols;
	}

	private String hexAddress(long offset) {
		return "0x" + Long.toHexString(offset);
	}

	private AddressRange singleRange(Function function) {
		AddressRangeIterator ranges = function.getBody().getAddressRanges();
		if (!ranges.hasNext()) {
			return null;
		}
		AddressRange only = ranges.next();
		return ranges.hasNext() ? null : only;
	}

	private String decompile(DecompInterface decomp, Function function) {
		DecompileResults results = decomp.decompileFunction(function, DECOMPILE_TIMEOUT_SEC, monitor);
		if (results == null || results.getDecompiledFunction() == null) {
			return "";
		}
		String c = results.getDecompiledFunction().getC();
		return c == null ? "" : c;
	}

	private String disassemble(Function function) {
		StringBuilder text = new StringBuilder();
		InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
		while (instructions.hasNext()) {
			Instruction instruction = instructions.next();
			text.append(instruction.getAddress()).append("  ").append(instruction).append('\n');
		}
		return text.toString();
	}

	private String sha256(File file) throws Exception {
		MessageDigest digest = MessageDigest.getInstance("SHA-256");
		try (FileInputStream in = new FileInputStream(file)) {
			byte[] buf = new byte[65536];
			int n;
			while ((n = in.read(buf)) > 0) {
				digest.update(buf, 0, n);
			}
		}
		byte[] hash = digest.digest();
		StringBuilder hex = new StringBuilder(hash.length * 2);
		for (byte b : hash) {
			hex.append(String.format("%02x", b));
		}
		return hex.toString();
	}
}
