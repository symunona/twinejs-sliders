const CodeMirror = {
	// A REAL Doc: the passage registry is the model, headless, and tests drive it as is.
	Doc: jest.requireActual('codemirror').Doc,
	defineExtension: jest.fn(),
	defineMode: jest.fn(),
	defineOption: jest.fn(),
	on: jest.fn(),
	registerHelper: jest.fn()
};

export default CodeMirror;
